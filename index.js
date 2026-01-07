const express = require("express");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const crypto = require("crypto");
const archiver = require("archiver");
const axios = require("axios");
const process = require("process");
require('dotenv').config();
const os = require("os");

const app = express();
const PORT = process.env.PORT || 10000;

const MAX_RETRIES = 5;

let SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
let SPOTIFY_REFRESH_TOKEN = process.env.SPOTIFY_REFRESH_TOKEN

let proxies = [];
if (fs.existsSync('proxies.txt')) {
    proxies = fs.readFileSync('proxies.txt', 'utf-8')
        .split('\n').map(p => p.trim()).filter(p => p.length > 0 && !p.startsWith('#'));
    console.log(`[PROXY] Loaded ${proxies.length} proxies.`);
}

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const DOWNLOAD_DIR = path.join(__dirname, "public", "downloads");
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

const activeDownloads = {};
const jobProcesses = {};
const clients = {};

// Cleanup (24h)
setInterval(() => {
    const now = Date.now();
    const expiry = 24 * 60 * 60 * 1000;
    fs.readdir(DOWNLOAD_DIR, (err, files) => {
        if (err) return;
        files.forEach(file => {
            const filePath = path.join(DOWNLOAD_DIR, file);
            fs.stat(filePath, (err, stats) => {
                if (err) return;
                if (now - stats.mtimeMs > expiry) {
                    fs.rm(filePath, { recursive: true, force: true }, () => {});
                    delete activeDownloads[file];
                }
            });
        });
    });
}, 60 * 60 * 1000);

let spotifyToken = null;
let tokenExpiration = 0;

async function getSpotifyToken() {
    if (spotifyToken && Date.now() < tokenExpiration) return spotifyToken;
    try {
        const params = new URLSearchParams();
        params.append('grant_type', 'refresh_token');
        params.append('refresh_token', SPOTIFY_REFRESH_TOKEN);
        params.append('client_id', SPOTIFY_CLIENT_ID);

        const res = await axios.post('https://accounts.spotify.com/api/token', params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        SPOTIFY_REFRESH_TOKEN = res.data.refresh_token
        spotifyToken = res.data.access_token;
        tokenExpiration = Date.now() + (res.data.expires_in * 1000);
        return spotifyToken;
    } catch (e) {
        console.error("Spotify Auth Error:", e.response ? e.response.data : e.message);
        throw new Error("Spotify Auth Failed. Check Refresh Token.");
    }
}

async function getSpotifyMetadata(link) {
    const token = await getSpotifyToken();
    const url = new URL(link);
    const parts = url.pathname.split('/').filter(p => p);
    const type = parts.find(p => ['track', 'album', 'playlist'].includes(p));
    const id = parts[parts.indexOf(type) + 1];

    if (!type || !id) throw new Error("Invalid Link");

    const res = await axios.get(`https://api.spotify.com/v1/${type}s/${id}`, { headers: { 'Authorization': `Bearer ${token}` } });
    const data = res.data;

    let tracks = [];
    let title = data.name;
    let cover = data.images?.[0]?.url || data.album?.images?.[0]?.url || "";

    if (type === 'track') {
        tracks.push({ title: data.name, artist: data.artists.map(a => a.name).join(', ') });
    } else {
        let nextUrl = data.tracks.href;
        while (nextUrl) {
            const trackRes = await axios.get(nextUrl, { headers: { 'Authorization': `Bearer ${token}` } });
            const trackData = trackRes.data;
            const newTracks = trackData.items.map(item => {
                const t = item.track || item;
                if (!t || !t.name) return null;
                return { title: t.name, artist: t.artists.map(a => a.name).join(', ') };
            }).filter(t => t);
            tracks.push(...newTracks);
            nextUrl = trackData.next;
        }
    }
    return { title, cover, type, tracks };
}

function sanitize(name) { return name.replace(/[^a-zA-Z0-9 \-\(\)\.]/g, "").trim(); }

function downloadWithYtDlp(query, filename, outputFolder, proxyUrl, format, registerChild) {
    return new Promise((resolve) => {
        const safeFilename = sanitize(filename);
        const outputPath = path.join(outputFolder, `${safeFilename}.${format}`);

        const args = [
            '-x', '--audio-format', format, '--audio-quality', '0',
            '--no-playlist', '--add-metadata',
            '-o', outputPath,
            `ytsearch1:${query}`
        ];

        if (proxyUrl) args.push('--proxy', proxyUrl);

        const child = spawn('yt-dlp', args);

        if (registerChild) registerChild(child);

        child.on('close', (code) => {
            if (code === 0 && fs.existsSync(outputPath)) resolve(true);
            else resolve(false);
        });

        child.on('error', () => resolve(false));
    });
}

function zipFiles(sourceFolder, zipFilePath, format) {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(zipFilePath);
        const archive = archiver('zip', { zlib: { level: 9 } });
        output.on('close', () => resolve());
        archive.on('error', (err) => reject(err));
        archive.pipe(output);
        archive.glob(`*.${format}`, { cwd: sourceFolder });
        archive.finalize();
    });
}

async function processQueue(tracks, outputFolder, uuid, metaData, format, namingPattern, email, baseUrl) {
    let completed = 0;
    const total = tracks.length;

    activeDownloads[uuid] = { progress: 0, message: "Starting...", done: false, cancelled: false };
    jobProcesses[uuid] = [];

    const updateState = (msg, percent, url = "", done = false, isZip = false) => {
        if (activeDownloads[uuid].cancelled) return;
        activeDownloads[uuid] = { ...activeDownloads[uuid], progress: percent, message: msg, url, done, isZip };
        if (clients[uuid]) clients[uuid].write(`data: ${JSON.stringify(activeDownloads[uuid])}\n\n`);
    };

    const numCores = os.cpus().length;
    const freeMemMB = os.freemem() / 1024 / 1024;
    const memLimit = Math.floor(freeMemMB / 150);
    const WORKERS_PER_CORE = 2;
    const totalWorkers = Math.min(numCores * WORKERS_PER_CORE, memLimit, total);

    console.log(`[QUEUE] Using ${totalWorkers} workers (Cores: ${numCores}, Free RAM: ${Math.floor(freeMemMB)}MB)`);

    const trackQueue = [...tracks];

    const worker = async () => {
        let localProxyIndex = proxies.length > 0 ? Math.floor(Math.random() * proxies.length) : -1;

        while (trackQueue.length > 0) {
            if (activeDownloads[uuid].cancelled) break;

            const track = trackQueue.shift();
            if (!track) break;

            const query = `${track.artist} - ${track.title} audio`;
            let filename = namingPattern.replace(/%t/g, track.title).replace(/%a/g, track.artist);

            let attempts = 0;
            let success = false;

            while (attempts < MAX_RETRIES && !success) {
                if (activeDownloads[uuid].cancelled) break;
                attempts++;
                const currentProxy = localProxyIndex !== -1 ? proxies[localProxyIndex] : null;

                updateState(`Downloading: ${track.title}`, Math.min(98, Math.round((completed / total) * 100)));

                success = await downloadWithYtDlp(query, filename, outputFolder, currentProxy, format, (child) => {
                    if (jobProcesses[uuid]) jobProcesses[uuid].push(child);
                });

                if (!success) {
                    if (proxies.length > 0) localProxyIndex = (localProxyIndex + 1) % proxies.length;
                    else await new Promise(r => setTimeout(r, 2000));
                }
            }
            if (success) completed++;
        }
    };

    const workers = Array(totalWorkers).fill(null).map(() => worker());
    await Promise.all(workers);

    if (activeDownloads[uuid].cancelled) {
        if (clients[uuid]) { clients[uuid].end(); delete clients[uuid]; }
        delete jobProcesses[uuid];
        fs.rm(outputFolder, { recursive: true, force: true }, () => { });
        return;
    }

    let finalUrl = "";
    const files = fs.readdirSync(outputFolder).filter(f => f.endsWith(`.${format}`));
    const isSingle = files.length === 1;

    if (files.length === 0) {
        updateState("Failed: No files downloaded", 0, "", true, false);
        return;
    }

    if (isSingle) {
        finalUrl = `/downloads/${uuid}/${files[0]}`;
    } else {
        updateState("Archiving...", 99);
        const safeTitle = sanitize(metaData.title) || "Playlist";
        const zipName = `${safeTitle}.zip`;
        const zipPath = path.join(outputFolder, zipName);
        await zipFiles(outputFolder, zipPath, format);
        fs.readdirSync(outputFolder).filter(f => f.endsWith(`.${format}`)).forEach(f => fs.unlinkSync(path.join(outputFolder, f)));
        finalUrl = `/downloads/${uuid}/${encodeURIComponent(zipName)}`;
    }

    if(email) {
        //email logic here
    }

    updateState("Done", 100, finalUrl, true, !isSingle);
    setTimeout(() => {
        if (clients[uuid]) { clients[uuid].end(); delete clients[uuid]; }
        delete jobProcesses[uuid];
    }, 1000);
}

// --- ROUTES ---
app.get("/", (req, res) => res.render("index", { title: "SpotiTools" }));

app.post("/api/info", async (req, res) => {
    try {
        const data = await getSpotifyMetadata(req.body.link);
        res.json({ title: data.title, cover: data.cover, tracks: data.tracks, type: data.type });
    } catch (e) { res.status(400).json({ error: "Fetch failed." }); }
});

app.post("/api/start-download", async (req, res) => {
    const { tracks, format, title, type, pattern, email } = req.body;
    const safeFormat = ['mp3', 'flac', 'm4a', 'wav', 'ogg'].includes(format) ? format : 'mp3';
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const downloadId = crypto.randomBytes(32).toString('hex');
    const outputFolder = path.join(DOWNLOAD_DIR, downloadId);
    fs.mkdirSync(outputFolder);
    res.json({ success: true, downloadId, total: tracks.length });
    await processQueue(tracks, outputFolder, downloadId, {type, title}, safeFormat, pattern || "%t", email, baseUrl);
});

app.post("/api/cancel", (req, res) => {
    const { uuid } = req.body;
    if (activeDownloads[uuid]) {
        activeDownloads[uuid].cancelled = true;
        if (jobProcesses[uuid]) jobProcesses[uuid].forEach(child => { try { child.kill('SIGKILL'); } catch (e) {} });
        res.json({ success: true });
    } else res.json({ success: false });
});

app.get("/api/status/:id", (req, res) => {
    const { id } = req.params;
    if (activeDownloads[id]) res.json({ active: true, ...activeDownloads[id] });
    else res.json({ active: false, exists: fs.existsSync(path.join(DOWNLOAD_DIR, id)) });
});

app.get("/api/progress/:id", (req, res) => {
    const { id } = req.params;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    clients[id] = res;
    if (activeDownloads[id]) res.write(`data: ${JSON.stringify(activeDownloads[id])}\n\n`);
    req.on('close', () => delete clients[id]);
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
