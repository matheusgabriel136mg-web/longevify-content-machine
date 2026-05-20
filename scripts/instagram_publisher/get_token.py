#!/usr/bin/env python3
"""Helper: gets Long-Lived Page Access Token for Instagram Graph API.

Usage:
  1. Fill META_APP_ID and META_APP_SECRET in .env
  2. Run: python3 get_token.py
  3. Browser opens → authorize with Facebook
  4. Script captures token, lists your Pages, you pick the one
  5. Saves META_PAGE_ACCESS_TOKEN, IG_BUSINESS_ACCOUNT_ID to .env

Requires `requests`: pip install requests
"""
import os, sys, json, webbrowser, http.server, socketserver, threading, urllib.parse
from pathlib import Path

try:
    import requests
except ImportError:
    sys.exit('pip install requests')

ENV_PATH = Path(__file__).parent / '.env'

def load_env():
    if not ENV_PATH.exists(): return
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line: continue
        k, _, v = line.partition('=')
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

def update_env(updates: dict):
    text = ENV_PATH.read_text() if ENV_PATH.exists() else ''
    lines = text.splitlines()
    keys_seen = set()
    for i, l in enumerate(lines):
        for k, v in updates.items():
            if l.startswith(f'{k}='):
                lines[i] = f'{k}={v}'
                keys_seen.add(k)
    for k, v in updates.items():
        if k not in keys_seen:
            lines.append(f'{k}={v}')
    ENV_PATH.write_text('\n'.join(lines) + '\n')
    print(f'  saved to .env: {", ".join(updates.keys())}')

load_env()
APP_ID = os.getenv('META_APP_ID')
APP_SECRET = os.getenv('META_APP_SECRET')
if not APP_ID or not APP_SECRET:
    sys.exit('Set META_APP_ID and META_APP_SECRET in .env first.')

REDIRECT_URI = 'http://localhost:8910/callback'
SCOPES = ','.join([
    'pages_show_list',
    'pages_read_engagement',
    'pages_manage_posts',
    'instagram_basic',
    'instagram_content_publish',
    'business_management',
])

# --- Local callback server ---
captured_code = {}
class CallbackHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        q = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(q)
        if 'code' in params:
            captured_code['code'] = params['code'][0]
            self.send_response(200)
            self.send_header('Content-type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write(b'<h2>OK! Volta pro terminal.</h2>')
        else:
            self.send_response(400)
            self.end_headers()
    def log_message(self, *a): pass

def run_server():
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(('', 8910), CallbackHandler) as httpd:
        while 'code' not in captured_code:
            httpd.handle_request()

print('[1/4] Starting local callback server on :8910...')
threading.Thread(target=run_server, daemon=True).start()

auth_url = (
    f'https://www.facebook.com/v23.0/dialog/oauth?'
    f'client_id={APP_ID}&redirect_uri={urllib.parse.quote(REDIRECT_URI)}'
    f'&scope={SCOPES}&response_type=code'
)
print(f'[2/4] Opening browser for authorization...')
print(f'  (if browser doesn\'t open, paste this URL): {auth_url}')
webbrowser.open(auth_url)

# Wait for code
import time
while 'code' not in captured_code:
    time.sleep(0.5)
code = captured_code['code']
print(f'  got code')

print('[3/4] Exchanging for User Access Token...')
r = requests.get('https://graph.facebook.com/v23.0/oauth/access_token', params={
    'client_id': APP_ID,
    'client_secret': APP_SECRET,
    'redirect_uri': REDIRECT_URI,
    'code': code,
}).json()
if 'access_token' not in r:
    sys.exit(f'Token exchange failed: {r}')
short_token = r['access_token']

# Long-lived user token (60 days)
r = requests.get('https://graph.facebook.com/v23.0/oauth/access_token', params={
    'grant_type': 'fb_exchange_token',
    'client_id': APP_ID,
    'client_secret': APP_SECRET,
    'fb_exchange_token': short_token,
}).json()
long_user_token = r['access_token']
print(f'  long-lived user token acquired')

print('[4/4] Listing your Pages...')
r = requests.get('https://graph.facebook.com/v23.0/me/accounts', params={
    'access_token': long_user_token,
    'fields': 'id,name,access_token,instagram_business_account',
}).json()
pages = r.get('data', [])
if not pages:
    sys.exit('No Pages found on this account.')

print()
for i, p in enumerate(pages):
    ig = p.get('instagram_business_account', {}).get('id', '(none)')
    print(f'  [{i}] {p["name"]}  Page={p["id"]}  IG={ig}')
choice = int(input('\n  Choose Page index: ').strip())
chosen = pages[choice]
ig_account_id = chosen.get('instagram_business_account', {}).get('id')
if not ig_account_id:
    sys.exit('Selected Page has no linked IG Business account.')

# Page Access Token from long-lived user token = never expires
update_env({
    'META_PAGE_ACCESS_TOKEN': chosen['access_token'],
    'META_PAGE_ID': chosen['id'],
    'IG_BUSINESS_ACCOUNT_ID': ig_account_id,
})
print('\n✓ Done. .env updated. You can now run publish_story.py')
