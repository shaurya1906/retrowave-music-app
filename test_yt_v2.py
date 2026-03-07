import yt_dlp
import sys

def test_extraction(video_id):
    clients = ['android', 'ios', 'tvicap', 'mweb']
    ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    
    for client in clients:
        print(f"Testing client: {client}")
        try:
            ydl_opts = {
                'format': 'bestaudio/best',
                'quiet': False, # Show more info
                'no_warnings': False,
                'nocheckcertificate': True,
                'user_agent': ua,
                'extractor_args': {'youtube': {'player_client': [client]}}
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
                if info and 'url' in info:
                    print(f"SUCCESS with {client}!")
                    print(f"URL: {info['url'][:100]}...")
                    return True
        except Exception as e:
            print(f"FAILED with {client}: {e}")
            continue
    return False

if __name__ == "__main__":
    vid = "v6_r5vU6AHE" # Levitating
    if len(sys.argv) > 1:
        vid = sys.argv[1]
    success = test_extraction(vid)
    if not success:
        print("All clients failed.")
        sys.exit(1)
