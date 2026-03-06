import requests

def test_search():
    try:
        response = requests.get('http://localhost:5003/api/yt/search?query=synthwave')
        print("Status code:", response.status_code)
        print("Response JSON length:", len(response.json()['results']) if 'results' in response.json() else response.json())
        print("First track:", response.json()['results'][0]['trackName'] if response.json().get('results') else "No results")
    except Exception as e:
        print("Failed:", e)

if __name__ == '__main__':
    test_search()
