const urlInput = document.getElementById('urlInput');
const checkBtn = document.getElementById('checkBtn');
const loader = document.getElementById('loader');
const resultCard = document.getElementById('resultCard');
const statusLog = document.getElementById('statusLog');
const logMessage = document.getElementById('logMessage');

async function fetchInfo() {
    const link = urlInput.value.trim();
    if (!link) return alert("Please enter a URL");

    resultCard.classList.add('hidden');
    statusLog.classList.add('hidden');
    loader.classList.remove('hidden');
    checkBtn.disabled = true;

    try {
        const res = await fetch('/api/info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ link })
        });

        const data = await res.json();

        if (res.status === 429) throw new Error(data.error);
        if (!res.ok) throw new Error(data.error || "Failed to fetch info");

        document.getElementById('playlistTitle').innerText = data.title;
        document.getElementById('albumCover').src = data.cover;
        document.getElementById('songCount').innerText = data.totalSongs;
        document.getElementById('estTime').innerText = data.estimatedTime;

        resultCard.classList.remove('hidden');

    } catch (err) {
        alert(err.message);
    } finally {
        loader.classList.add('hidden');
        checkBtn.disabled = false;
    }
}

async function startDownload() {
    const link = document.getElementById('urlInput').value;
    const btn = document.getElementById('downloadBtn');
    btn.disabled = true;
    btn.innerHTML = "Downloading... (This may take time)";

    try {
        const response = await fetch('/api/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ link })
        });

        const data = await response.json();

        if (data.success) {
            alert(`Success! Downloaded songs.`);
            window.location.href = `/downloads/${data.downloadId}`;
        } else {
            alert("Error: " + data.error);
        }

    } catch (err) {
        alert("Network Error or Timeout");
    } finally {
        btn.disabled = false;
        btn.innerHTML = "Download";
    }
}
