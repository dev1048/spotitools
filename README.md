# SpotiTools 🎵

**SpotiTools** is a lightweight, web-based utility designed to download Spotify playlists. Built with Node.js and Express, it bridges the gap between your Spotify library and your local storage by fetching metadata and sourcing audio through powerful open-source backends.

## 🚀 How it Works

SpotiTools follows a "metadata-first" approach to ensure it remains lightweight and effective:
1. **Fetch**: It retrieves track information (Title, Artist, Album) from the Spotify API.
2. **Search**: It uses those details to find the best matching audio source via `yt-dlp`.
3. **Process**: It downloads and converts the audio using `ffmpeg`.

## 🛠️ Prerequisites

To run this application, you must have the following installed and configured in your system's **PATH**:

*   **Node.js**: (v16.x or higher)
*   **yt-dlp**: The core engine for searching and downloading audio. [Download here](https://github.com/yt-dlp/yt-dlp).
*   **FFmpeg**: Required for audio conversion, post-processing, and embedding metadata. [Download here](https://ffmpeg.org/download.html).

## ⚙️ Installation & Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/dev1048/spotitools.git
   cd spotitools
   ```
2. **Install dependencies**
   ```bash
   npm install
   ```
3. **Configure Environment Variables:**
   Create a `.env` file in the root directory
   ```bash
   SPOTIFY_CLIENT_ID=your_spotify_client_id
   SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
   PORT=3000
   ```
4. **Start the application**
   ```bash
   node index.js
   ```
## 🌍 Live Demo

You can try out the application directly without any setup by visiting:  
👉 **[spotitools.app](https://spotitools.app)**

---

## ⚖️ TOS & Compliance

**SpotiTools does not break Spotify's Terms of Service.** 

Unlike tools that attempt to bypass Spotify’s encrypted streaming protocols or DRM, SpotiTools **does not download audio from Spotify’s servers.** It only uses the Spotify API to read public metadata (track names and artists). The actual audio is searched for and sourced from public platforms using `yt-dlp`. This approach ensures that Spotify’s core security and streaming protocols remain untouched and respected.

## ⚠️ Disclaimer

This tool is intended for **educational and personal use only**. The developer is not responsible for any misuse of this application. Users are encouraged to respect the intellectual property rights of artists and ensure they have the legal right to access the content they download. Use this tool at your own risk.

## 📄 License

This project currently does not have a formal license. You are free to use, modify, and explore the code for personal development and learning purposes.
