from ytmusicapi import YTMusic
import yt_dlp
import json

def test():
    yt = YTMusic()
    print("Searching for 'Pink Floyd'...")
    results = yt.search("Pink Floyd", filter="songs", limit=1)
    if not results:
        print("No results found.")
        return
    
    song = results[0]
    print(f"Found: {song['title']} by {','.join(a['name'] for a in song['artists'])}")
    video_id = song['videoId']
    
    print(f"Extracting stream URL for {video_id}...")
    ydl_opts = {
        'format': 'bestaudio/best',
        'quiet': True,
        'no_warnings': True,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
        print(f"Stream URL found: {info['url'][:50]}...")

if __name__ == "__main__":
    try:
        test()
    except Exception as e:
        print(f"Error: {e}")
