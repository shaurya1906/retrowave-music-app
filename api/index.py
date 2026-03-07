from flask import Flask, request, jsonify, Response, redirect, make_response
from flask_cors import CORS
import urllib.request
import urllib.parse
import json
import os
import uuid
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
from ytmusicapi import YTMusic
import yt_dlp

app = Flask(__name__)
CORS(app, supports_credentials=True)

GOOGLE_CLIENT_ID = "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com"

# In-memory session store (Note: This won't persist well in Vercel serverless)
SESSIONS = {}

# Initialize YTMusic lazily
_yt_instance = None
def get_yt():
    global _yt_instance
    if _yt_instance is None:
        _yt_instance = YTMusic()
    return _yt_instance

def get_session():
    session_id = request.cookies.get('session_id')
    return SESSIONS.get(session_id) if session_id else None

@app.route('/api/auth/login', methods=['POST'])
def auth_login():
    data = request.json
    token = data.get('credential')
    try:
        if token == 'mock_guest_token':
            idinfo = {
                'name': 'Retro Guest', 
                'email': 'guest@retro.wave', 
                'picture': 'https://api.dicebear.com/7.x/bottts/svg?seed=guest'
            }
        else:
            idinfo = id_token.verify_oauth2_token(token, google_requests.Request(), GOOGLE_CLIENT_ID)
            if idinfo['iss'] not in ['accounts.google.com', 'https://accounts.google.com']:
                raise ValueError('Wrong issuer.')

        session_id = str(uuid.uuid4())
        user_data = {
            "name": idinfo.get('name'),
            "email": idinfo.get('email'),
            "picture": idinfo.get('picture'),
            "playlists": {},
            "library": []
        }
        SESSIONS[session_id] = user_data
        
        resp = jsonify({"success": True, "user": user_data})
        resp.set_cookie('session_id', session_id, httponly=True, samesite='Lax', path='/')
        return resp
    except Exception as e:
        return jsonify({"error": str(e)}), 401

@app.route('/api/auth/me', methods=['GET'])
def auth_me():
    user = get_session()
    return jsonify({"authenticated": user is not None, "user": user})

@app.route('/api/auth/logout', methods=['GET'])
def auth_logout():
    session_id = request.cookies.get('session_id')
    if session_id in SESSIONS:
        del SESSIONS[session_id]
    resp = jsonify({"success": True})
    resp.set_cookie('session_id', '', expires=0, path='/')
    return resp

@app.route('/api/yt/search', methods=['GET'])
def yt_search():
    query = request.args.get('query', '')
    limit = int(request.args.get('limit', 20))
    try:
        yt_inst = get_yt()
        results = yt_inst.search(query, filter="songs", limit=limit)
        formatted = []
        if results:
            for s in results:
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
        return jsonify({"success": True, "results": formatted})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

import requests as requests_lib
@app.route('/api/user/playlists', methods=['GET', 'POST'])
def handle_playlists():
    session = get_session()
    if not session: return jsonify({"error": "Unauthorized"}), 401
    
    if request.method == 'GET':
        return jsonify({"success": True, "playlists": session.get('playlists', {})})
    
    data = request.json
    action = data.get('action')
    playlist_name = data.get('playlistName')
    if not playlist_name: return jsonify({"error": "Playlist name required"}), 400
    
    playlists = session.setdefault('playlists', {})
    if action == 'create':
        if playlist_name in playlists: return jsonify({"error": "Exists"}), 400
        playlists[playlist_name] = []
    elif action == 'add':
        song = data.get('song')
        if not song: return jsonify({"error": "Song required"}), 400
        if playlist_name not in playlists: playlists[playlist_name] = []
        if not any(s['videoId'] == song['videoId'] for s in playlists[playlist_name]):
            playlists[playlist_name].append(song)
    elif action == 'remove':
        video_id = data.get('videoId')
        if playlist_name in playlists:
            playlists[playlist_name] = [s for s in playlists[playlist_name] if s['videoId'] != video_id]
            
    return jsonify({"success": True})

@app.route('/api/user/library', methods=['GET', 'POST'])
def handle_library():
    session = get_session()
    if not session: return jsonify({"error": "Unauthorized"}), 401
    
    if request.method == 'GET':
        return jsonify({"success": True, "library": session.get('library', [])})
    
    data = request.json
    action = data.get('action')
    song = data.get('song')
    if not song: return jsonify({"error": "Song required"}), 400
    
    library = session.setdefault('library', [])
    if action == 'add':
        if not any(s['videoId'] == song['videoId'] for s in library):
            library.append(song)
    elif action == 'remove':
        session['library'] = [s for s in library if s['videoId'] != song['videoId']]
            
    return jsonify({"success": True, "library": session.get('library', [])})

@app.route('/api/yt/stream', methods=['GET'])
def yt_stream():
    video_id = request.args.get('videoId', '')
    if not video_id: return jsonify({"error": "Missing videoId"}), 400
    try:
        ydl_opts = {'format': 'bestaudio/best', 'quiet': True, 'no_warnings': True}
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
            stream_url = info['url']
        return jsonify({"success": True, "url": stream_url})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/yt/play', methods=['GET'])
def yt_play():
    video_id = request.args.get('videoId', '')
    if not video_id or len(video_id) > 20 or not all(c.isalnum() or c in '-_' for c in video_id):
        return jsonify({"error": "Invalid videoId"}), 400

    try:
        ydl_opts = {'format': 'bestaudio/best', 'quiet': True, 'no_warnings': True}
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
            stream_url = info['url']
            
        req_headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
        if range_header := request.headers.get('Range'):
            req_headers['Range'] = range_header

        req = urllib.request.Request(stream_url, headers=req_headers)
        with urllib.request.urlopen(req) as response:
            def generate():
                while True:
                    chunk = response.read(65536)
                    if not chunk: break
                    yield chunk

            resp = Response(generate(), status=response.status)
            for header in ['Content-Type', 'Content-Length', 'Accept-Ranges', 'Content-Range']:
                if val := response.headers.get(header):
                    resp.headers[header] = val
            return resp
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# Fallback for local development
if __name__ == "__main__":
    app.run(port=5003)
