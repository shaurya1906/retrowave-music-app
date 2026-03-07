/* ============================================
   RETROWAVE — APP LOGIC
   iTunes Search API · 30-sec previews
   ============================================ */

(() => {
    'use strict';

    // ---- DOM Refs ----
    const searchInput = document.getElementById('searchInput');
    const searchBtn = document.getElementById('searchBtn');
    const resultsGrid = document.getElementById('resultsGrid');
    const resultsTitle = document.getElementById('resultsTitle');
    const loader = document.getElementById('loader');
    const noResults = document.getElementById('noResults');
    const playerBar = document.getElementById('playerBar');
    const playerArt = document.getElementById('playerArt');
    const playerTitle = document.getElementById('playerTitle');
    const playerArtist = document.getElementById('playerArtist');
    const playPauseBtn = document.getElementById('playPauseBtn');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    const progressBar = document.getElementById('progressBar');
    const progressFill = document.getElementById('progressFill');
    const playerTime = document.getElementById('playerTime');
    const closePlayer = document.getElementById('closePlayer');
    const decadeBtns = document.querySelectorAll('.decade-btn');
    const playerDebug = document.createElement('div');
    playerDebug.style = "position:absolute; top:-30px; left:0; width:100%; text-align:center; font-size:10px; color:rgba(255,255,255,0.3); pointer-events:none;";
    playerDebug.id = "playerDebug";

    // ---- State ----
    let tracks = [];
    let currentIndex = -1;
    let isPlaying = false;
    let currentUser = null;
    let userSettings = {
        theme: 'retrowave',
        defaultDecade: '2020',
        autoplay: false
    };
    let playlists = JSON.parse(localStorage.getItem('retrowave_playlists') || '{}');
    let library = JSON.parse(localStorage.getItem('retrowave_library') || '[]');
    let pendingSong = null;
    let audioUnlocked = false;

    // Playback State
    let ytPlayer = null;
    let isPlayerReady = false;
    let playbackMode = 'yt'; // 'yt' or 'proxy'
    const audioPlayer = document.getElementById('mainAudioPlayer');
    let progressInterval = null;

    // YT API Callback
    window.onYouTubeIframeAPIReady = () => {
        ytPlayer = new YT.Player('yt-player-container', {
            height: '1',
            width: '1',
            videoId: '',
            playerVars: {
                'autoplay': 0,
                'controls': 0,
                'disablekb': 1,
                'fs': 0,
                'rel': 0,
                'modestbranding': 1
            },
            events: {
                'onReady': () => { isPlayerReady = true; console.log("YT Player Ready"); },
                'onStateChange': onPlayerStateChange,
                'onError': onPlayerError
            }
        });
    };

    function onPlayerStateChange(event) {
        if (playbackMode !== 'yt') return;
        // YT.PlayerState.ENDED = 0
        if (event.data === 0) handleEnded();
        // YT.PlayerState.PLAYING = 1
        if (event.data === 1) {
            isPlaying = true;
            startProgressLoop();
        } else {
            isPlaying = false;
            stopProgressLoop();
        }
        updatePlayPauseIcon();
    }

    function onPlayerError(event) {
        console.warn("YT Player Error, falling back to proxy...", event);
        const t = currentPlaybackList[currentIndex];
        if (t) fallbackToProxy(t);
    }

    // Proxy Player Listeners
    audioPlayer.addEventListener('play', () => {
        if (playbackMode !== 'proxy') return;
        isPlaying = true;
        updatePlayPauseIcon();
    });

    audioPlayer.addEventListener('pause', () => {
        if (playbackMode !== 'proxy') return;
        isPlaying = false;
        updatePlayPauseIcon();
    });

    audioPlayer.addEventListener('timeupdate', () => {
        if (playbackMode !== 'proxy') return;
        if (audioPlayer.duration > 0) {
            updateProgressUI(audioPlayer.currentTime, audioPlayer.duration);
        }
    });

    audioPlayer.addEventListener('ended', () => {
        if (playbackMode === 'proxy') handleEnded();
    });

    audioPlayer.addEventListener('error', (e) => {
        if (playbackMode !== 'proxy') return;
        console.error("Proxy Player Error:", e);
        playerTitle.textContent = "Mobile Sync Error";
        isPlaying = false;
        updatePlayPauseIcon();
    });

    function updateProgressUI(cur, dur) {
        const pct = (cur / dur) * 100;
        progressFill.style.width = pct + '%';
        playerTime.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
    }

    function startProgressLoop() {
        stopProgressLoop();
        progressInterval = setInterval(() => {
            if (playbackMode === 'yt' && ytPlayer && ytPlayer.getCurrentTime) {
                updateProgressUI(ytPlayer.getCurrentTime(), ytPlayer.getDuration());
            }
        }, 500);
    }

    function stopProgressLoop() {
        if (progressInterval) clearInterval(progressInterval);
    }

    const GOOGLE_CLIENT_ID = "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com";

    // ---- Helpers ----
    // We route all JioSaavn requests through our local python proxy server.
    const API_BASE = '/api';

    function formatTime(sec) {
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    }

    // ---- YT Music Search ----
    async function fetchTracks(term, limit = 20) {
        try {
            const url = `/api/yt/search?query=${encodeURIComponent(term)}&limit=${limit}`;
            const res = await fetch(url);
            if (!res || !res.ok) {
                const errorData = await res.json().catch(() => ({}));
                throw new Error(errorData.error || 'Network error');
            }
            const data = await res.json();
            if (!data.success || !data.results) throw new Error('Invalid response structure');

            return data.results.map(t => ({
                trackName: t.trackName,
                artistName: t.artistName,
                artworkUrl100: t.artworkUrl100,
                videoId: t.videoId,
                releaseDate: t.releaseDate,
                albumName: t.albumName,
                previewUrl: '' // To be resolved on play
            }));
        } catch (err) {
            console.error("Search failed:", err);
            throw err;
        }
    }

    // ---- Render ----
    function renderCards(list) {
        resultsGrid.innerHTML = '';
        if (!list.length) {
            noResults.classList.remove('hidden');
            return;
        }
        noResults.classList.add('hidden');

        list.forEach((track, idx) => {
            const year = new Date(track.releaseDate).getFullYear();
            const isLiked = library.some(s => s.videoId === track.videoId);
            const card = document.createElement('div');
            card.className = 'song-card';
            card.dataset.index = idx;
            card.innerHTML = `
        <div class="card-controls">
            <button class="like-btn ${isLiked ? 'liked' : ''}" title="${isLiked ? 'Unlike' : 'Like'}">
                <svg viewBox="0 0 24 24" fill="${isLiked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" style="width:18px;height:18px">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                </svg>
            </button>
            <button class="add-to-playlist-btn" title="Add to Playlist">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px">
                    <path d="M12 5v14M5 12h14"/>
                </svg>
            </button>
        </div>
        <img class="card-art" src="${track.artworkUrl100}" alt="${track.trackName}" loading="lazy">
        <div class="card-body">
          <div class="card-title" title="${track.trackName}">${track.trackName}</div>
          <div class="card-artist" title="${track.artistName}">${track.artistName}</div>
          <span class="card-year">${year}</span>
        </div>
      `;
            card.addEventListener('click', (e) => {
                if (e.target.closest('.add-to-playlist-btn')) {
                    e.stopPropagation();
                    openAddToPlaylist(track);
                } else if (e.target.closest('.like-btn')) {
                    e.stopPropagation();
                    toggleLike(track);
                } else {
                    playSong(idx, list);
                }
            });
            resultsGrid.appendChild(card);
        });
    }

    function highlightPlaying() {
        document.querySelectorAll('.song-card').forEach(c => c.classList.remove('playing'));
        if (currentIndex >= 0 && tracks === currentPlaybackList) {
            const card = resultsGrid.querySelector(`[data-index="${currentIndex}"]`);
            if (card) card.classList.add('playing');
        }
    }

    // ---- Playback ----
    let currentPlaybackList = [];
    async function playSong(idx, list = tracks) {
        if (idx < 0 || idx >= list.length) return;
        currentIndex = idx;
        currentPlaybackList = list;
        const t = list[idx];

        // Highlight immediately
        highlightPlaying();
        playerTitle.textContent = "Loading...";
        playerArtist.textContent = t.trackName;
        playerBar.classList.remove('hidden');
        if (!document.getElementById('playerDebug')) playerBar.appendChild(playerDebug);
        updateDebugInfo("Initial Loading...");

        // Reset both players
        stopBoth();

        if (isPlayerReady) {
            playbackMode = 'yt';
            updateDebugInfo("Attempting YT IFrame...");
            try {
                ytPlayer.loadVideoById(t.videoId);
                ytPlayer.playVideo();
                playerArt.src = t.artworkUrl100;
                playerTitle.textContent = t.trackName;
                playerArtist.textContent = t.artistName;
            } catch (err) {
                console.warn("YT Play failed, falling back...", err);
                updateDebugInfo("YT Failed, Falling back...");
                fallbackToProxy(t);
            }
        } else {
            console.log("YT Player not ready, using proxy fallback");
            updateDebugInfo("YT Not Ready, Using Proxy...");
            fallbackToProxy(t);
        }
    }

    function fallbackToProxy(t) {
        playbackMode = 'proxy';
        updateDebugInfo("Proxy Mode Active");
        stopBoth();
        audioPlayer.src = `/api/yt/play?videoId=${t.videoId}`;
        audioPlayer.play().catch(async (e) => {
            console.error("Proxy playback failed, trying direct URL...", e);
            updateDebugInfo("Proxy Failed, Trying Direct URL...");
            await fallbackToDirect(t);
        });
        playerArt.src = t.artworkUrl100;
        playerTitle.textContent = t.trackName;
        playerArtist.textContent = t.artistName;
        updatePlayPauseIcon();
    }

    async function fallbackToDirect(t) {
        playbackMode = 'direct';
        updateDebugInfo("Direct Mode Active");
        try {
            const res = await fetch(`/api/yt/stream_url?videoId=${t.videoId}`);
            const data = await res.json();
            if (data.success && data.url) {
                audioPlayer.src = data.url;
                await audioPlayer.play();
                updateDebugInfo("Playing via Direct URL");
            } else {
                throw new Error(data.error || "No URL");
            }
        } catch (err) {
            console.error("Direct playback failed:", err);
            updateDebugInfo(`All Modes Failed: ${err.message}`);
            playerTitle.textContent = "Mobile Sync Error";
            isPlaying = false;
            updatePlayPauseIcon();
            showToast("Error playing song. YouTube may be blocking playback.");
        }
    }

    // Helpers
    function unlockAudio() {
        if (audioUnlocked) return;
        audioPlayer.play().then(() => {
            audioPlayer.pause();
            audioUnlocked = true;
            console.log("Audio Context Unlocked");
        }).catch(() => { });
    }
    document.addEventListener('click', unlockAudio, { once: true });
    document.addEventListener('touchstart', unlockAudio, { once: true });

    function showToast(msg) {
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = msg;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.classList.add('show');
            setTimeout(() => {
                toast.classList.remove('show');
                setTimeout(() => toast.remove(), 500);
            }, 3000);
        }, 100);
    }

    function updateDebugInfo(msg) {
        const debugEl = document.getElementById('playerDebug');
        if (debugEl) debugEl.textContent = `V2.2 | MODE: ${playbackMode} | ${msg || ''}`;
    }

    function stopBoth() {
        if (ytPlayer && ytPlayer.pauseVideo) ytPlayer.pauseVideo();
        audioPlayer.pause();
        audioPlayer.src = "";
        stopProgressLoop();
    }

    function togglePlay() {
        if (playbackMode === 'yt' && ytPlayer) {
            const state = ytPlayer.getPlayerState();
            if (state === 1) ytPlayer.pauseVideo();
            else ytPlayer.playVideo();
        } else if (playbackMode === 'proxy') {
            if (audioPlayer.paused) audioPlayer.play();
            else audioPlayer.pause();
        }
        updatePlayPauseIcon();
    }

    function handleEnded() {
        if (currentIndex < currentPlaybackList.length - 1) {
            playSong(currentIndex + 1, currentPlaybackList);
        } else {
            isPlaying = false;
            updatePlayPauseIcon();
        }
    }

    function updatePlayPauseIcon() {
        const playIcon = playPauseBtn.querySelector('.icon-play');
        const pauseIcon = playPauseBtn.querySelector('.icon-pause');
        playIcon.classList.toggle('hidden', isPlaying);
        pauseIcon.classList.toggle('hidden', !isPlaying);
    }

    function saveToLocal() {
        localStorage.setItem('retrowave_playlists', JSON.stringify(playlists));
        localStorage.setItem('retrowave_library', JSON.stringify(library));
    }

    // ---- Search Action ----
    async function doSearch(query) {
        console.log("doSearch called with query:", query);
        if (!query.trim()) return;
        setActiveSection('hero');
        loader.classList.remove('hidden');
        noResults.classList.add('hidden');
        resultsGrid.innerHTML = '';
        resultsTitle.textContent = `Results for "${query}"`;

        try {
            tracks = await fetchTracks(query);
            renderCards(tracks);
        } catch (e) {
            console.error(e);
            noResults.textContent = 'Server offline or network error. Please ensure the backend (server.py) is running!';
            noResults.classList.remove('hidden');
        } finally {
            loader.classList.add('hidden');
        }
    }

    // ---- Decade Browse ----
    async function browseDecade(startYear) {
        setActiveSection('hero');
        const decadeLabel = `${startYear}s`;
        const genreHints = {
            1970: 'classic rock soul funk 1970s',
            1980: 'pop rock 80s synthpop 1980s',
            1990: 'grunge hip hop r&b 1990s',
            2000: 'pop rock hip hop 2000s',
            2010: 'pop edm hip hop 2010s',
            2020: 'pop hits 2020s trending',
        };
        const term = genreHints[startYear] || `best songs ${startYear}s`;
        loader.classList.remove('hidden');
        noResults.classList.add('hidden');
        resultsGrid.innerHTML = '';
        resultsTitle.textContent = `Hits of the ${decadeLabel}`;

        try {
            tracks = await fetchTracks(term, 30);
            renderCards(tracks);
        } catch (e) {
            console.error(e);
            noResults.textContent = 'Couldn\'t load this decade. Try again!';
            noResults.classList.remove('hidden');
        } finally {
            loader.classList.add('hidden');
        }
    }

    // ---- Playlist Logic ----
    async function fetchPlaylists() {
        try {
            const res = await fetch('/api/user/playlists');
            const data = await res.json();
            if (data.success) {
                playlists = data.playlists;
                renderPlaylists();
            }
        } catch (err) {
            console.error("Failed to fetch playlists:", err);
        }
    }

    function renderPlaylists() {
        const playlistList = document.getElementById('playlistList');
        if (!playlistList) return;

        playlistList.innerHTML = '';
        const names = Object.keys(playlists);

        if (names.length === 0) {
            playlistList.innerHTML = '<p class="no-results">You haven\'t created any playlists yet.</p>';
            return;
        }

        names.forEach(name => {
            const card = document.createElement('div');
            card.className = 'playlist-card';
            card.innerHTML = `
                <div class="playlist-icon">📁</div>
                <div class="playlist-name">${name}</div>
                <div class="card-artist">${playlists[name].length} songs</div>
            `;
            card.addEventListener('click', () => showPlaylistSongs(name));
            playlistList.appendChild(card);
        });
    }

    function showPlaylistSongs(name) {
        document.getElementById('playlistList').classList.add('hidden');
        document.getElementById('playlistSongs').classList.remove('hidden');
        document.getElementById('currentPlaylistName').textContent = name;

        const grid = document.getElementById('playlistSongsGrid');
        grid.innerHTML = '';

        const list = playlists[name];
        list.forEach((track, idx) => {
            const year = new Date(track.releaseDate).getFullYear();
            const card = document.createElement('div');
            card.className = 'song-card';
            card.innerHTML = `
                <button class="add-to-playlist-btn remove-btn" title="Remove from Playlist">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px">
                    <path d="M18 6L6 18M6 6l12 12"/>
                  </svg>
                </button>
                <img class="card-art" src="${track.artworkUrl100}" alt="${track.trackName}">
                <div class="card-body">
                  <div class="card-title">${track.trackName}</div>
                  <div class="card-artist">${track.artistName}</div>
                </div>
            `;
            card.querySelector('.remove-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                removeFromPlaylist(name, track.videoId);
            });
            card.addEventListener('click', () => playSong(idx, list));
            grid.appendChild(card);
        });
    }

    async function removeFromPlaylist(playlistName, videoId) {
        try {
            const res = await fetch('/api/user/playlists', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'remove', playlistName, videoId })
            });
            const data = await res.json();
            if (data.success) {
                await fetchPlaylists();
                showPlaylistSongs(playlistName);
            }
        } catch (err) {
            console.error("Remove failed:", err);
        }
    }

    function openAddToPlaylist(track) {
        if (!currentUser) {
            alert("Please log in to create playlists.");
            return;
        }
        pendingSong = track;
        const modal = document.getElementById('playlistModalOverlay');
        const container = document.getElementById('existingPlaylists');
        container.innerHTML = '';

        Object.keys(playlists).forEach(name => {
            const div = document.createElement('div');
            div.className = 'playlist-option';
            div.innerHTML = `<span>${name}</span> <span>+</span>`;
            div.onclick = () => addToPlaylist(name);
            container.appendChild(div);
        });

        modal.classList.add('active');
    }

    async function addToPlaylist(name) {
        if (!pendingSong) return;
        try {
            const res = await fetch('/api/user/playlists', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'add', playlistName: name, song: pendingSong })
            });
            const data = await res.json();
            if (data.success) {
                document.getElementById('playlistModalOverlay').classList.remove('active');
                playlists[name].push(pendingSong);
                saveToLocal();
                fetchPlaylists();
            }
        } catch (err) {
            console.error("Add failed:", err);
        }
    }

    async function createAndAdd() {
        const name = document.getElementById('newPlaylistInput').value.trim();
        if (!name) return;
        try {
            const res = await fetch('/api/user/playlists', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'create', playlistName: name })
            });
            const data = await res.json();
            if (data.success) {
                await addToPlaylist(name);
                document.getElementById('newPlaylistInput').value = '';
            }
        } catch (err) {
            console.error("Create failed:", err);
        }
    }

    function setActiveSection(id) {
        const sections = ['hero', 'decades', 'playlists', 'library', 'trending'];
        sections.forEach(s => {
            const el = document.getElementById(s);
            if (el) el.classList.add('hidden');
        });

        if (id === 'hero' || id === 'decades' || id === 'trending' || id === 'search') {
            document.getElementById('hero').classList.remove('hidden');
            document.getElementById('decades').classList.remove('hidden');
            document.querySelector('.results-section').classList.remove('hidden');
            document.getElementById('playlists').classList.add('hidden');
            document.getElementById('library').classList.add('hidden');
        } else if (id === 'playlists') {
            document.getElementById('hero').classList.add('hidden');
            document.getElementById('decades').classList.add('hidden');
            document.querySelector('.results-section').classList.add('hidden');
            document.getElementById('library').classList.add('hidden');
            document.getElementById('playlists').classList.remove('hidden');
            fetchPlaylists();
        } else if (id === 'library') {
            document.getElementById('hero').classList.add('hidden');
            document.getElementById('decades').classList.add('hidden');
            document.querySelector('.results-section').classList.add('hidden');
            document.getElementById('playlists').classList.add('hidden');
            document.getElementById('library').classList.remove('hidden');
            fetchLibrary();
        }

        document.querySelectorAll('.nav-link').forEach(l => {
            l.classList.toggle('active', l.dataset.section === id);
        });
    }

    async function fetchLibrary() {
        try {
            const res = await fetch('/api/user/library');
            const data = await res.json();
            if (data.success) {
                library = data.library;
                renderLibrary();
            }
        } catch (err) {
            console.error("Failed to fetch library:", err);
        }
    }

    function renderLibrary() {
        const grid = document.getElementById('libraryGrid');
        if (!grid) return;
        grid.innerHTML = '';

        if (library.length === 0) {
            grid.innerHTML = '<p class="no-results">Your library is empty. Start liking songs!</p>';
            return;
        }

        library.forEach((track, idx) => {
            const card = document.createElement('div');
            card.className = 'song-card';
            card.innerHTML = `
                <div class="card-controls">
                    <button class="like-btn liked" title="Unlike">
                        <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" style="width:18px;height:18px">
                            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                        </svg>
                    </button>
                </div>
                <img class="card-art" src="${track.artworkUrl100}" alt="${track.trackName}">
                <div class="card-body">
                  <div class="card-title">${track.trackName}</div>
                  <div class="card-artist">${track.artistName}</div>
                </div>
            `;
            card.querySelector('.like-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                toggleLike(track);
            });
            card.addEventListener('click', () => playSong(idx, library));
            grid.appendChild(card);
        });
    }

    async function toggleLike(track) {
        if (!currentUser) {
            alert("Please log in to add songs to your library.");
            return;
        }
        const isLiked = library.some(s => s.videoId === track.videoId);
        const action = isLiked ? 'remove' : 'add';
        try {
            const res = await fetch('/api/user/library', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, song: track })
            });
            const data = await res.json();
            if (data.success) {
                library = data.library;
                saveToLocal();
                // Refresh current view if needed
                const activeSection = document.querySelector('.nav-link.active').dataset.section;
                if (activeSection === 'library') renderLibrary();
                else renderCards(tracks); // Refresh trending/search results to update heart icons
            }
        } catch (err) {
            console.error("Toggle like failed:", err);
        }
    }

    // ---- Auth Logic ----
    function initGoogleAuth() {
        if (!window.google) {
            setTimeout(initGoogleAuth, 100);
            return;
        }

        google.accounts.id.initialize({
            client_id: GOOGLE_CLIENT_ID,
            callback: handleCredentialResponse
        });

        renderGoogleButton();
    }

    function renderGoogleButton() {
        const btn = document.getElementById("g_id_signin");
        if (btn) {
            btn.innerHTML = '';

            const googleDiv = document.createElement('div');
            btn.appendChild(googleDiv);

            if (window.google) {
                google.accounts.id.renderButton(
                    googleDiv,
                    { theme: "outline", size: "large", type: "standard", shape: "pill" }
                );
            }

            const guestBtn = document.createElement('button');
            guestBtn.textContent = 'Demo Login';
            guestBtn.className = 'search-btn';
            guestBtn.style.padding = '8px 16px';
            guestBtn.style.fontSize = '0.85rem';
            guestBtn.style.marginLeft = '10px';
            guestBtn.addEventListener('click', () => {
                handleCredentialResponse({ credential: 'mock_guest_token' });
            });

            btn.appendChild(guestBtn);
            btn.style.display = 'flex';
            btn.style.alignItems = 'center';
        }
    }

    async function handleCredentialResponse(response) {
        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ credential: response.credential })
            });
            const data = await res.json();
            if (data.success) {
                updateUserUI(data.user);
                fetchPlaylists();
                fetchLibrary();
            }
        } catch (err) {
            console.error("Login failed:", err);
        }
    }

    async function checkSession() {
        try {
            const res = await fetch('/api/auth/me');
            const data = await res.json();
            if (data.authenticated) {
                updateUserUI(data.user);
                fetchPlaylists();
                fetchLibrary();
            }
        } catch (err) {
            console.error("Session check failed:", err);
        }
    }

    function updateUserUI(user) {
        currentUser = user;
        const loginBtn = document.getElementById('g_id_signin');
        const userProfile = document.getElementById('userProfile');
        const userAvatar = document.getElementById('userAvatar');
        const userName = document.getElementById('userName');

        if (user) {
            if (loginBtn) loginBtn.classList.add('hidden');
            if (userProfile) userProfile.classList.remove('hidden');
            if (userAvatar) userAvatar.src = user.picture;
            if (userName) userName.textContent = user.name;
        } else {
            if (loginBtn) loginBtn.classList.remove('hidden');
            if (userProfile) userProfile.classList.add('hidden');
            renderGoogleButton();
        }
    }

    async function logout() {
        try {
            await fetch('/api/auth/logout');
            updateUserUI(null);
            playlists = {};
            library = [];
        } catch (err) {
            console.error("Logout failed:", err);
        }
    }

    // ---- Settings Logic ----
    function loadSettings() {
        const saved = localStorage.getItem('retrowave_settings');
        if (saved) {
            userSettings = { ...userSettings, ...JSON.parse(saved) };
        }
        applySettings();
    }

    function saveSettings() {
        userSettings = {
            theme: document.getElementById('themeSelect').value,
            defaultDecade: document.getElementById('defaultDecadeSelect').value,
            autoplay: document.getElementById('autoplayToggle').checked
        };
        localStorage.setItem('retrowave_settings', JSON.stringify(userSettings));
        console.log("Preferences saved:", userSettings);
        applySettings();
        toggleSettingsModal(false);
    }

    function applySettings() {
        document.body.classList.remove('theme-dark', 'theme-light');
        if (userSettings.theme !== 'retrowave') {
            document.body.classList.add(`theme-${userSettings.theme}`);
        }

        if (document.getElementById('themeSelect')) document.getElementById('themeSelect').value = userSettings.theme;
        if (document.getElementById('defaultDecadeSelect')) document.getElementById('defaultDecadeSelect').value = userSettings.defaultDecade;
        if (document.getElementById('autoplayToggle')) document.getElementById('autoplayToggle').checked = userSettings.autoplay;
    }

    function toggleSettingsModal(show) {
        const modal = document.getElementById('settingsModalOverlay');
        if (modal) modal.classList.toggle('active', show);
    }

    // Modal listeners
    if (document.getElementById('openSettings')) document.getElementById('openSettings').addEventListener('click', () => toggleSettingsModal(true));
    if (document.getElementById('closeSettings')) document.getElementById('closeSettings').addEventListener('click', () => toggleSettingsModal(false));
    if (document.getElementById('settingsModalOverlay')) document.getElementById('settingsModalOverlay').addEventListener('click', (e) => {
        if (e.target.id === 'settingsModalOverlay') toggleSettingsModal(false);
    });
    if (document.getElementById('saveSettingsBtn')) document.getElementById('saveSettingsBtn').addEventListener('click', saveSettings);
    if (document.getElementById('logoutBtn')) document.getElementById('logoutBtn').addEventListener('click', logout);

    // Playlist Modal
    if (document.getElementById('closePlaylistModal')) document.getElementById('closePlaylistModal').addEventListener('click', () => {
        document.getElementById('playlistModalOverlay').classList.remove('active');
    });
    if (document.getElementById('createAndAddBtn')) document.getElementById('createAndAddBtn').addEventListener('click', createAndAdd);
    if (document.getElementById('backToPlaylists')) document.getElementById('backToPlaylists').addEventListener('click', () => {
        document.getElementById('playlistList').classList.remove('hidden');
        document.getElementById('playlistSongs').classList.add('hidden');
        renderPlaylists();
    });
    if (document.getElementById('createNewPlaylistBtn')) document.getElementById('createNewPlaylistBtn').addEventListener('click', () => {
        const name = prompt("Enter new playlist name:");
        if (name) {
            fetch('/api/user/playlists', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'create', playlistName: name })
            }).then(() => fetchPlaylists());
        }
    });

    // ---- Initial Load ----
    async function loadTrending() {
        loader.classList.remove('hidden');
        try {
            const term = userSettings.defaultDecade ? `hits of the ${userSettings.defaultDecade}s` : 'top hits 2024 2025';
            tracks = await fetchTracks(term, 30);
            renderCards(tracks);
        } catch (e) {
            console.error(e);
        } finally {
            loader.classList.add('hidden');
        }
    }

    // ---- Event Listeners ----
    if (searchBtn) searchBtn.addEventListener('click', () => {
        console.log("Search button clicked! Input value:", searchInput.value);
        doSearch(searchInput.value);
    });
    if (searchInput) searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(searchInput.value); });

    if (playPauseBtn) playPauseBtn.addEventListener('click', togglePlay);
    if (prevBtn) prevBtn.addEventListener('click', () => playSong(currentIndex - 1, currentPlaybackList));
    if (nextBtn) nextBtn.addEventListener('click', () => playSong(currentIndex + 1, currentPlaybackList));
    if (closePlayer) closePlayer.addEventListener('click', () => {
        stopBoth();
        isPlaying = false;
        playerBar.classList.add('hidden');
        highlightPlaying();
    });

    // Progress
    if (progressBar) progressBar.addEventListener('click', e => {
        const rect = progressBar.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;

        if (playbackMode === 'yt' && ytPlayer && ytPlayer.getDuration) {
            const dur = ytPlayer.getDuration();
            if (dur > 0) ytPlayer.seekTo(pct * dur, true);
        } else if (playbackMode === 'proxy' && audioPlayer.duration > 0) {
            audioPlayer.currentTime = pct * audioPlayer.duration;
        }
    });

    // Decades
    decadeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            decadeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            browseDecade(Number(btn.dataset.decade));
            document.querySelector('.results-section').scrollIntoView({ behavior: 'smooth' });
        });
    });

    // Smooth scroll nav
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', e => {
            e.preventDefault();
            setActiveSection(link.dataset.section);
            const target = document.getElementById(link.dataset.section);
            if (target) target.scrollIntoView({ behavior: 'smooth' });
        });
    });

    // Boot
    loadSettings();
    initGoogleAuth();
    checkSession();
    loadTrending();
})();
