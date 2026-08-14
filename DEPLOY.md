# Deploying Airport Route Atlas to Hostinger

The site is fully static — no build step. Every asset path in `index.html` and
`main.js` is relative, so the files work from any document root as long as they
are all in the same directory.

Files that must be deployed:

```
index.html
main.js
style.css
airports.csv
routes.csv
1 airport view.jpg
2 hub view.png
3 route view.jpg
.htaccess
```

## 1. Create the subdomain

In hPanel: **Domains → Subdomains**, create `airportroutes` under
`nextworldatlas.com`.

Note the document root it creates — typically:

```
/home/<user>/domains/nextworldatlas.com/public_html/airportroutes
```

Everything below uses that path. Do **not** deploy into the main
`public_html`, or the files will land on the apex domain instead.

## 2. Connect the repo (hPanel Git deploy)

In hPanel: **Websites → Manage → Advanced → GIT**.

1. **Repository:** `https://github.com/nextworldatlas/airport_route_atlas`
2. **Branch:** `main`
3. **Install path:** the subdomain document root from step 1.

The target directory must be empty for the first deploy — if hPanel refuses,
delete the default placeholder `index.html` it created with the subdomain.

If the repo is private, hPanel shows an SSH public key. Add it in GitHub under
**Settings → Deploy keys → Add deploy key** (read-only is enough), then use the
SSH URL `git@github.com:nextworldatlas/airport_route_atlas.git` instead.

Click **Deploy** to pull the current `main`.

## 3. Auto-deploy on push (optional)

hPanel's GIT page shows an **auto-deployment webhook URL**. Add it in GitHub
under **Settings → Webhooks → Add webhook**:

- Payload URL: the hPanel webhook URL
- Content type: `application/json`
- Events: *Just the push event*

After that, pushes to `main` redeploy automatically. Without the webhook, hit
**Deploy** in hPanel after each push.

## 4. Turn off GitHub Pages

The `CNAME` file has been removed from the repo, which detaches the custom
domain. Also disable the site itself in GitHub under **Settings → Pages** —
set **Source** to *None*. Otherwise a stale copy stays live at
`nextworldatlas.github.io/airport_route_atlas`.

## 5. Enable SSL

hPanel: **Websites → Manage → Security → SSL**, install the free Let's Encrypt
certificate for `airportroutes.nextworldatlas.com`. The `.htaccess` in this repo
redirects HTTP to HTTPS, so issue the certificate before pointing traffic at the
subdomain, or the redirect will lead to a certificate warning.

## 6. Verify

- `https://airportroutes.nextworldatlas.com` loads the globe.
- The "Loading flight data..." message clears — that means `airports.csv` and
  `routes.csv` were fetched successfully.
- Browser devtools → Network shows `content-encoding: gzip` on the two CSVs
  (that's the `.htaccess` compression working; it takes them from ~850 KB to
  roughly a quarter of that).

## Notes

- Two dependencies load from CDNs at runtime (`unpkg.com/globe.gl` and
  `esm.sh/d3-dsv`), so the site needs outbound network access from the
  visitor's browser. This is unchanged from the GitHub Pages setup.
- The three screenshot filenames contain spaces. That is fine on Hostinger's
  Linux hosting, but avoid renaming them without also updating `index.html`.
