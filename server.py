"""
Retrowave Music App — Local Server
Serves static files and proxies YT Music requests.
"""

import http.server
from http.server import ThreadingHTTPServer
import urllib.request
import urllib.parse
import json
import os
import sys
import uuid
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
from ytmusicapi import YTMusic
import yt_dlp

PORT = 5003
GOOGLE_CLIENT_ID = "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com"

# In-memory session store
SESSIONS = {}

# Initialize YTMusic lazily
_yt_instance = None
def get_yt():
    global _yt_instance
    if _yt_instance is None:
        _yt_instance = YTMusic()
    return _yt_instance

class RetrowaveHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/api/yt/search"):
            self._yt_search()
        elif self.path.startswith("/api/yt/stream"):
            self._yt_stream()
        elif self.path.startswith("/api/auth/me"):
            self._auth_me()
        elif self.path.startswith("/api/auth/logout"):
            self._auth_logout()
        elif self.path.startswith("/api/user/playlists"):
            self._handle_playlists()
        elif self.path.startswith("/api/user/library"):
            self._handle_library()
        elif self.path.startswith("/api/user/preferences"):
            self._get_preferences()
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == "/api/auth/login":
            self._auth_login()
        elif self.path == "/api/user/playlists":
            self._handle_playlists()
        elif self.path == "/api/user/library":
            self._handle_library()
        elif self.path == "/api/user/preferences":
            self._set_preferences()
        else:
            self.send_error(404)

    def _handle_playlists(self):
        session = self._get_session()
        if not session:
            return self._send_error("Unauthorized", 401)
        
        if self.command == "GET":
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "playlists": session.get('playlists', {})}).encode())
        
        elif self.command == "POST":
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length).decode('utf-8')
            try:
                data = json.loads(post_data)
                action = data.get('action') # 'create', 'add', 'remove'
                playlist_name = data.get('playlistName')
                
                if not playlist_name:
                    return self._send_error("Playlist name required")
                
                playlists = session.setdefault('playlists', {})
                
                if action == 'create':
                    if playlist_name in playlists:
                        return self._send_error("Playlist already exists")
                    playlists[playlist_name] = []
                
                elif action == 'add':
                    song = data.get('song')
                    if not song: return self._send_error("Song data required")
                    if playlist_name not in playlists: playlists[playlist_name] = []
                    # Avoid duplicates
                    if not any(s['videoId'] == song['videoId'] for s in playlists[playlist_name]):
                        playlists[playlist_name].append(song)
                
                elif action == 'remove':
                    video_id = data.get('videoId')
                    if playlist_name in playlists:
                        playlists[playlist_name] = [s for s in playlists[playlist_name] if s['videoId'] != video_id]
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"success": True}).encode())
                
            except Exception as e:
                self._send_error(str(e))

    def _handle_library(self):
        session = self._get_session()
        if not session:
            return self._send_error("Unauthorized", 401)
        
        if self.command == "GET":
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "library": session.get('library', [])}).encode())
        
        elif self.command == "POST":
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length).decode('utf-8')
            try:
                data = json.loads(post_data)
                action = data.get('action') # 'add', 'remove'
                song = data.get('song')
                
                if not song: return self._send_error("Song data required")
                
                library = session.setdefault('library', [])
                
                if action == 'add':
                    if not any(s['videoId'] == song['videoId'] for s in library):
                        library.append(song)
                
                elif action == 'remove':
                    session['library'] = [s for s in library if s['videoId'] != song['videoId']]
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"success": True, "library": session['library']}).encode())
                
            except Exception as e:
                self._send_error(str(e))

    def _get_session(self):
        cookies = self.headers.get('Cookie', '')
        for cookie in cookies.split(';'):
            if 'session_id=' in cookie:
                session_id = cookie.split('session_id=')[1].strip()
                return SESSIONS.get(session_id)
        return None

    def _auth_login(self):
        content_length = int(self.headers['Content-Length'])
        post_data = self.rfile.read(content_length).decode('utf-8')
        try:
            data = json.loads(post_data)
            token = data.get('credential')
            
            if token == 'mock_guest_token':
                idinfo = {
                    'name': 'Retro Guest', 
                    'email': 'guest@retro.wave', 
                    'picture': 'https://api.dicebear.com/7.x/bottts/svg?seed=guest'
                }
            else:
                # Verify the ID token
                idinfo = id_token.verify_oauth2_token(token, google_requests.Request(), GOOGLE_CLIENT_ID)
                
                if idinfo['iss'] not in ['accounts.google.com', 'https://accounts.google.com']:
                    raise ValueError('Wrong issuer.')

            # Create a session
            session_id = str(uuid.uuid4())
            user_data = {
                "name": idinfo.get('name'),
                "email": idinfo.get('email'),
                "picture": idinfo.get('picture'),
                "playlists": {},
                "library": [] # Added: list of liked songs
            }
            SESSIONS[session_id] = user_data
            
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Set-Cookie', f'session_id={session_id}; Path=/; HttpOnly; SameSite=Lax')
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "user": user_data}).encode())
            
        except Exception as e:
            print(f"[Auth] Login error: {e}")
            self._send_error(str(e), 401)

    def _auth_me(self):
        user = self._get_session()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({"authenticated": user is not None, "user": user}).encode())

    def _auth_logout(self):
        cookies = self.headers.get('Cookie', '')
        session_id = None
        for cookie in cookies.split(';'):
            if 'session_id=' in cookie:
                session_id = cookie.split('session_id=')[1].strip()
                break
        
        if session_id in SESSIONS:
            del SESSIONS[session_id]
            
        self.send_response(200)
        self.send_header('Set-Cookie', 'session_id=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT')
        self.end_headers()
        self.wfile.write(json.dumps({"success": True}).encode())

    def _get_preferences(self):
        session = self._get_session()
        if not session:
            return self._send_error("Unauthorized", 401)
        
        prefs = session.get('preferences', {})
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(prefs).encode())

    def _set_preferences(self):
        session = self._get_session()
        if not session:
            return self._send_error("Unauthorized", 401)
            
        content_length = int(self.headers['Content-Length'])
        post_data = self.rfile.read(content_length).decode('utf-8')
        try:
            prefs = json.loads(post_data)
            session['preferences'] = prefs
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"success": True}).encode())
        except Exception as e:
            self._send_error(str(e))

    def _yt_search(self):
        params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        query = params.get('query', [''])[0]
        limit = int(params.get('limit', [20])[0])
        
        print(f"[YT Search] Query: '{query}', Limit: {limit}")
        
        try:
            yt_inst = get_yt()
            results = yt_inst.search(query, filter="songs", limit=limit)
            print(f"[YT Search] Found {len(results) if results else 0} raw results")
            formatted = []
            if results:
                for s in results:
                    try:
                        thumbnails = s.get('thumbnails', [])
                        thumb_url = thumbnails[-1].get('url', '') if thumbnails else ''
                        
                        formatted.append({
                            "trackName": s.get('title', 'Unknown Title'),
                            "artistName": ", ".join(a.get('name', 'Unknown Artist') for a in s.get('artists', [])),
                            "artworkUrl100": thumb_url,
                            "videoId": s.get('videoId'),
                            "releaseDate": str(s.get('year', '2000')) + "-01-01",
                            "albumName": s.get('album', {}).get('name', '') if s.get('album') else ''
                        })
                    except Exception as loop_e:
                        print(f"[YT Search] Skipping result due to error: {loop_e}")
                        continue
            
            print(f"[YT Search] Returning {len(formatted)} formatted results")
            body = json.dumps({"success": True, "results": formatted}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
        except Exception as e:
            print(f"[YT Search] Fatal error: {e}")
            self._send_error(str(e))

    def _yt_stream(self):
        params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        video_id = params.get('videoId', [''])[0]
        
        if not video_id:
            return self._send_error("Missing videoId")

        print(f"[YT Stream] Resolving Video ID: {video_id}")
        try:
            ydl_opts = {
                'format': 'bestaudio/best',
                'quiet': True,
                'no_warnings': True,
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
                stream_url = info['url']
                
            body = json.dumps({"success": True, "url": stream_url}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
        except Exception as e:
            print(f"[YT Stream] Error: {e}")
            self._send_error(str(e))

    def _send_error(self, message, status=500):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"error": message}).encode())

if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    print(f"[Retrowave] Server running at http://localhost:{PORT}")
    print("   Integrating YouTube Music & yt-dlp support...")
    print("   Press Ctrl+C to stop\n")
    server = ThreadingHTTPServer(("", PORT), RetrowaveHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
        server.server_close()
