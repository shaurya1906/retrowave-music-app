from playwright.sync_api import sync_playwright
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        
        # Capture console messages
        page.on("console", lambda msg: print(f"Browser console: {msg.text}"))
        
        print("Navigating to http://localhost:5003...")
        page.goto("http://localhost:5003", wait_until="networkidle")
        
        print("Filling search input...")
        page.fill("#searchInput", "Daft Punk")
        
        print("Clicking search button...")
        # Force a click in case it's intercepted or overlapping
        page.click("#searchBtn", force=True)
        
        print("Waiting 15 seconds for results...")
        time.sleep(15)
        
        print("Done.")
        browser.close()

if __name__ == "__main__":
    run()
