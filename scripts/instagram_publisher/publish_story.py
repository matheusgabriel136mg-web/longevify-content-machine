#!/usr/bin/env python3
"""Publish .mp4 to Instagram Stories via Graph API.

Usage: python3 publish_story.py path/to/video.mp4

Requires .env in same dir with:
  META_PAGE_ACCESS_TOKEN, IG_BUSINESS_ACCOUNT_ID, and ONE hosting set:
    - CLOUDINARY_URL
    - S3_BUCKET + S3_REGION + AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY
    - NGROK_AUTHTOKEN (last resort, local serve)
"""
import os, sys, time, json, mimetypes, subprocess, threading, http.server, socketserver
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import urlopen, Request
from urllib.parse import urlencode

GRAPH_API_VERSION = 'v23.0'
GRAPH = f'https://graph.facebook.com/{GRAPH_API_VERSION}'

# --- Tiny env loader (avoid python-dotenv dep) ---
def load_env(env_path):
    if not Path(env_path).exists(): return
    for line in Path(env_path).read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line: continue
        k, _, v = line.partition('=')
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

load_env(Path(__file__).parent / '.env')

def env(key, required=True):
    v = os.getenv(key)
    if required and not v:
        sys.exit(f'ERROR: env var {key} is required')
    return v

def http_post(url, data=None, files=None):
    if files:
        # multipart upload (we'll use requests if available, else a tiny manual one)
        try:
            import requests
            r = requests.post(url, data=data, files=files, timeout=300)
            r.raise_for_status()
            return r.json()
        except ImportError:
            sys.exit('Need `requests` for multipart uploads: pip install requests')
    body = urlencode(data or {}).encode()
    req = Request(url, data=body, method='POST')
    with urlopen(req, timeout=120) as r:
        return json.loads(r.read())

def http_get(url, params=None):
    if params:
        url = f'{url}?{urlencode(params)}'
    with urlopen(url, timeout=60) as r:
        return json.loads(r.read())

# --- Hosting backends: returns public HTTPS URL for the video ---

def host_cloudinary(video_path):
    import requests, hashlib, time as _t
    cl = os.getenv('CLOUDINARY_URL')
    if not cl: return None
    # cloudinary://API_KEY:API_SECRET@CLOUD_NAME
    p = urlparse(cl)
    api_key = p.username
    api_secret = p.password
    cloud_name = p.hostname
    timestamp = str(int(_t.time()))
    folder = 'longevify-stories'
    to_sign = f'folder={folder}&timestamp={timestamp}{api_secret}'
    signature = hashlib.sha1(to_sign.encode()).hexdigest()
    url = f'https://api.cloudinary.com/v1_1/{cloud_name}/video/upload'
    with open(video_path, 'rb') as f:
        r = requests.post(url, files={'file': f}, data={
            'api_key': api_key,
            'timestamp': timestamp,
            'signature': signature,
            'folder': folder,
        }, timeout=600)
    r.raise_for_status()
    return r.json()['secure_url']

def host_s3(video_path):
    bucket = os.getenv('S3_BUCKET')
    if not bucket: return None
    try:
        import boto3
    except ImportError:
        sys.exit('Need `boto3` for S3: pip install boto3')
    s3 = boto3.client('s3', region_name=os.getenv('S3_REGION', 'us-east-1'))
    key = f'longevify-stories/{int(time.time())}_{Path(video_path).name}'
    s3.upload_file(str(video_path), bucket, key,
                   ExtraArgs={'ContentType': 'video/mp4', 'ACL': 'public-read'})
    region = os.getenv('S3_REGION', 'us-east-1')
    return f'https://{bucket}.s3.{region}.amazonaws.com/{key}'

def host_ngrok(video_path):
    token = os.getenv('NGROK_AUTHTOKEN')
    if not token: return None
    try:
        from pyngrok import ngrok, conf
    except ImportError:
        sys.exit('Need `pyngrok`: pip install pyngrok')
    conf.get_default().auth_token = token
    serve_dir = Path(video_path).parent
    fname = Path(video_path).name
    port = 8765
    handler = http.server.SimpleHTTPRequestHandler
    os.chdir(serve_dir)
    httpd = socketserver.TCPServer(('', port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    public = ngrok.connect(port, 'http').public_url
    return f'{public}/{fname}'

def get_public_url(video_path):
    for fn in (host_cloudinary, host_s3, host_ngrok):
        url = fn(video_path)
        if url:
            print(f'  via {fn.__name__}: {url}')
            return url
    sys.exit('No hosting backend configured. Set CLOUDINARY_URL or S3_BUCKET or NGROK_AUTHTOKEN.')

# --- Graph API ---

def create_story_container(ig_id, token, video_url):
    r = http_post(f'{GRAPH}/{ig_id}/media', data={
        'media_type': 'STORIES',
        'video_url': video_url,
        'access_token': token,
    })
    if 'id' not in r:
        sys.exit(f'Container creation failed: {r}')
    return r['id']

def wait_container_ready(container_id, token, timeout=300):
    start = time.time()
    while time.time() - start < timeout:
        r = http_get(f'{GRAPH}/{container_id}', params={
            'fields': 'status_code,status',
            'access_token': token,
        })
        status = r.get('status_code')
        print(f'  container status: {status}')
        if status == 'FINISHED': return True
        if status == 'ERROR': sys.exit(f'Container error: {r}')
        time.sleep(5)
    sys.exit('Timeout waiting for container')

def publish_container(ig_id, token, container_id):
    r = http_post(f'{GRAPH}/{ig_id}/media_publish', data={
        'creation_id': container_id,
        'access_token': token,
    })
    if 'id' not in r:
        sys.exit(f'Publish failed: {r}')
    return r['id']

def main():
    if len(sys.argv) < 2:
        sys.exit('Usage: python3 publish_story.py path/to/video.mp4')
    video = Path(sys.argv[1]).resolve()
    if not video.exists():
        sys.exit(f'File not found: {video}')

    token = env('META_PAGE_ACCESS_TOKEN')
    ig_id = env('IG_BUSINESS_ACCOUNT_ID')

    print(f'[1/4] Hosting video publicly...')
    video_url = get_public_url(video)

    print(f'[2/4] Creating Story container...')
    cid = create_story_container(ig_id, token, video_url)
    print(f'  container_id={cid}')

    print(f'[3/4] Waiting for container to finish processing...')
    wait_container_ready(cid, token)

    print(f'[4/4] Publishing...')
    media_id = publish_container(ig_id, token, cid)
    print(f'\n✓ Published! Story media_id={media_id}')
    print(f'  (Stories are not visible via direct URL — check the IG app)')

if __name__ == '__main__':
    main()
