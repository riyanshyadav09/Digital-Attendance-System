# EC2 deployment runbook

This runbook targets the existing Amazon Linux 2023 instance. It does not create AWS resources. It assumes the repository is already cloned at `/home/ec2-user/digital-attendance-system`, Node.js 22, Python 3.11, Nginx, and build tools are installed. The face-service unit uses a separate `face-service/venv311` environment to avoid disturbing any older environment.

## Current deployment gate

Do not start the public application until the values below are available and verified:

- A MongoDB Atlas (or other reachable managed MongoDB) URI and database user. Add the EC2 egress address to the database network allowlist. Do not use `localhost` on EC2.
- Cloudinary cloud name, API key, and API secret.
- Brevo SMTP settings are optional for startup. Configure them only if email-based password reset is needed; without complete SMTP settings, that endpoint returns HTTP 503 without generating an OTP.
- An HTTPS name for the frontend. A domain is optional: Let's Encrypt now supports IP-address certificates, but they are short-lived (160 hours) and require Certbot 5.4+ with automatic renewal verified before production issuance. The instance currently has no Certbot installation, timer, or verified certificate. Inbound TCP 80 and 443 must already be allowed by the existing security group.
- Campus latitude, longitude, and permitted radius.
- Strong random `JWT_SECRET` and `FACE_SERVICE_TOKEN` values, each at least 32 characters. The face token must be identical in backend and face-service env files.

The current frontend can be built against `http://3.104.76.182/api`, but that is HTTP. Camera/geolocation features and production CORS require an HTTPS frontend origin. Without a domain, use `VITE_API_BASE_URL=https://3.104.76.182/api` after the IP certificate is installed and verified. The existing HTTPS Nginx template's `__DOMAIN__` placeholder should be replaced with the chosen DNS name or IP; for IP certificates the resulting Certbot live directory is keyed by that IP.

## Environment variables

The source of truth is `server/.env.example`, `face-service/.env.example`, and `client/.env.example`.

Backend required settings: `MONGO_URI`, `JWT_SECRET`, `CLIENT_URL`, `FACE_SERVICE_URL`, `FACE_SERVICE_TOKEN`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CAMPUS_LATITUDE`, `CAMPUS_LONGITUDE`, and `CAMPUS_RADIUS`.

Optional email password-reset settings: `BREVO_SMTP_HOST`, `BREVO_SMTP_PORT`, `BREVO_SMTP_USER`, `BREVO_SMTP_KEY`, `BREVO_FROM_EMAIL`, and `BREVO_FROM_NAME`. Configure all six to enable email-based password reset. Leave them blank if Brevo is not ready; application startup and other authenticated workflows remain available.

Backend optional/runtime settings: `PORT` (unit sets 5000), `HOST` (unit sets loopback), `NODE_ENV=production`, `FACE_SERVICE_TIMEOUT_MS` (defaults in source), and `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` (one-time admin creation only; do not leave a bootstrap password configured after use).

Face-service settings: `FACE_SERVICE_TOKEN` (same value as backend), `FACE_MODEL_NAME=buffalo_sc`, and `FACE_INFERENCE_THREADS=1`. `buffalo_sc` embeddings are model-version tagged. Existing embeddings tagged for another model are incompatible and require student re-enrollment before they can match.

Frontend build-time setting: `VITE_API_BASE_URL=https://<domain>/api`.

Never commit `.env` files or paste secrets into command history, tickets, or logs. Create `/etc/das-attendance/server.env` and `/etc/das-attendance/face.env` with an editor opened through `sudoedit`; set ownership to `root:ec2-user` and mode `0640`. Put the service token in both files. Keep the API and AI services bound to `127.0.0.1`.

After entering the values directly on EC2, run the non-printing configuration check from the repository root:

```bash
python3 deploy/ec2/preflight.py \
  --server-env /etc/das-attendance/server.env \
  --face-env /etc/das-attendance/face.env
```

It prints only `PASS` or `FAIL` and setting names. It never prints configured values.

## Build frontend locally

From the repository root in PowerShell, after a domain is ready:

```powershell
cd client
$env:VITE_API_BASE_URL = 'https://<domain>/api'
npm ci
npm run build
```

Transfer only `client/dist` to the instance, then install it under `/var/www/das-attendance` (not under `/home/ec2-user`, which is private to Nginx). Keep the old static directory until the new build is verified so rollback is possible.

## Install service configuration on the existing instance

Review the unit and Nginx templates in this directory first. Replace each `__DOMAIN__` placeholder with the actual DNS name or IP. Do not install the HTTPS template before its certificate paths exist.

1. Create `/etc/das-attendance/` and the two protected env files described above.
2. Prepare the isolated face-service environment without touching the existing `venv`:

   ```bash
   cd /home/ec2-user/digital-attendance-system/face-service
   python3.11 -m venv venv311
   venv311/bin/python -m pip install -r requirements.txt
   venv311/bin/python -m pip check
   venv311/bin/python -m compileall -q app.py services
   ```

   The first service start downloads the configured InsightFace model. Confirm disk space and watch memory during this first initialization.
3. Copy `das-face.service` and `das-api.service` to `/etc/systemd/system/`.
4. Put the frontend build in `/var/www/das-attendance` and make it readable by Nginx.
5. Initially install the HTTP Nginx template and validate with `sudo nginx -t`; reload Nginx only after validation succeeds.
6. Start the face service and verify `curl -fsS http://127.0.0.1:8000/health` reports `buffalo_sc` and its model ID. Start the API service and verify `curl -i http://127.0.0.1:5000/health` reports database connectivity.
7. For a no-domain option, first install an approved Certbot 5.4+ build. The Nginx HTTP template already serves the HTTP-01 webroot at `/var/www/certbot`. Test issuance against staging before considering a production certificate:

   ```bash
   sudo certbot certonly --staging --preferred-profile shortlived \
     --webroot --webroot-path /var/www/certbot \
     --ip-address 3.104.76.182
   ```

   Let’s Encrypt IP certificates last 160 hours (about 6.7 days), and recommends renewing every three days. Use the webroot authenticator; Certbot's Nginx installer does not currently install IP certificates. Before any production issuance, verify that an automated `certbot renew` timer runs at least every three days, configure a deploy hook to reload Nginx after a successful renewal, and pass `certbot renew --dry-run`. After issuance, point the HTTPS template certificate paths at `/etc/letsencrypt/live/3.104.76.182/{fullchain.pem,privkey.pem}`, then run `sudo nginx -t` before reloading Nginx. If you instead use a domain, use its directory name and DNS validation-ready webroot.
8. Enable services for reboot only after the health checks pass: `sudo systemctl enable --now das-face das-api nginx`.

Expected private service endpoints are `http://127.0.0.1:8000` for FastAPI and `http://127.0.0.1:5000` for Express. Public Nginx routes are `/`, `/api/...`, and `/health`; Nginx does not expose the face service directly.

## Validation and rollback

```bash
sudo systemctl status das-face das-api nginx --no-pager
sudo journalctl -u das-face -u das-api -n 100 --no-pager
curl -fsS http://127.0.0.1:8000/health
curl -i http://127.0.0.1:5000/health
curl -fsSI https://<domain>/health
```

Test login, registration, photo enrollment, group-photo recognition, and role permissions with consented accounts/photos. Confirm a student's stored embedding model ID matches the service model ID before attendance matching. Restore the previous frontend directory or Nginx config if checks fail; do not delete the previous deployment until the replacement has been verified.

## Known limitations and cost

No database, Cloudinary, SMTP, TLS, enrollment, or recognition integration has been verified in the current deployment environment. The EC2 instance is not yet running this application. IP certificates add a renewal-availability risk: a missed renewal can take the demo offline within days. Keep an eye on EC2, storage, network transfer, MongoDB, image storage, and email usage; AWS credits and free tiers do not guarantee a zero bill. Review the billing dashboard during the demo and stop/terminate demo resources when finished, after exporting any data you need.
