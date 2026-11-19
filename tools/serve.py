"""Local WebGPU preview. Revalidate modules on refresh and accept parallel asset loads."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def send_head(self):
        # Multiple saves to an ES module can occur within one HTTP-date second.
        if self.path.split('?')[0].endswith(('.js', '.html', '.css', '/')):
            del self.headers['If-Modified-Since']
        return super().send_head()

    def log_request(self, code='-', size='-'):
        if isinstance(code, int) and code >= 400:
            super().log_request(code, size)


class Server(ThreadingHTTPServer):
    request_queue_size = 64


if __name__=='__main__':
    root = Path(__file__).resolve().parents[1]
    with Server(('127.0.0.1',8765),partial(Handler,directory=str(root))) as server:
        print('http://127.0.0.1:8765/', flush=True)
        server.serve_forever()
