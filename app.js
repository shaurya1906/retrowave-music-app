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
    const audioEl = document.getElementById('audioEl');
    const decadeBtns = document.querySelectorAll('.decade-btn');

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
    let playlists = {};
    let library = [];
    let pendingSong = null;

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
        playerTitle.textContent = "Resolving stream...";
        playerArtist.textContent = t.trackName;
        playerBar.classList.remove('hidden');

        try {
            // Resolve stream URL
            const res = await fetch(`/api/yt/stream?videoId=${t.videoId}`);
            const data = await res.json();
            if (!data.success || !data.url) throw new Error("Stream resolution failed");

            audioEl.src = data.url;
            audioEl.play();
            isPlaying = true;

            playerArt.src = t.artworkUrl100;
            playerTitle.textContent = t.trackName;
            playerArtist.textContent = t.artistName;

            updatePlayPauseIcon();
        } catch (err) {
            console.error(err);
            playerTitle.textContent = "Error playing song";
            isPlaying = false;
            updatePlayPauseIcon();
        }
    }

    function togglePlay() {
        if (!audioEl.src) return;
        if (isPlaying) { audioEl.pause(); } else { audioEl.play(); }
        isPlaying = !isPlaying;
        updatePlayPauseIcon();
    }

    function updatePlayPauseIcon() {
        const playIcon = playPauseBtn.querySelector('.icon-play');
        const pauseIcon = playPauseBtn.querySelector('.icon-pause');
        playIcon.classList.toggle('hidden', isPlaying);
        pauseIcon.classList.toggle('hidden', !isPlaying);
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
        audioEl.pause();
        isPlaying = false;
        playerBar.classList.add('hidden');
        highlightPlaying();
    });

    // Progress
    audioEl.addEventListener('timeupdate', () => {
        if (!audioEl.duration) return;
        const pct = (audioEl.currentTime / audioEl.duration) * 100;
        if (progressFill) progressFill.style.width = pct + '%';
        if (playerTime) playerTime.textContent = `${formatTime(audioEl.currentTime)} / ${formatTime(audioEl.duration)}`;
    });
    audioEl.addEventListener('ended', () => {
        if (currentIndex < currentPlaybackList.length - 1) playSong(currentIndex + 1, currentPlaybackList);
        else { isPlaying = false; updatePlayPauseIcon(); }
    });
    if (progressBar) progressBar.addEventListener('click', e => {
        if (!audioEl.duration) return;
        const rect = progressBar.getBoundingClientRect();
        audioEl.currentTime = ((e.clientX - rect.left) / rect.width) * audioEl.duration;
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
