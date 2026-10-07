# Timeless Figures

Explore the most notable minds, rulers, and creators in human history.

An installable PWA built with vanilla HTML, CSS and JavaScript. No build step and no API keys.

## How it works

1. **Wikidata SPARQL** finds humans (`wdt:P31 wd:Q5`) with the chosen occupation (`wdt:P106`), ordered by `DESC(?sitelinks)` (how many Wikipedia languages cover them), top 20, with their English Wikipedia title.
2. **Wikipedia REST** (`/api/rest_v1/page/summary/{title}`) supplies the biography, short description and portrait for the dossier.

Roster results are cached in `localStorage` for 7 days to keep repeat visits fast and kind to the Wikidata servers.

## Files

```text
├── index.html
├── styles.css
├── app.js
├── manifest.json
├── sw.js
├── preview.png          Open Graph image (1200x630)
├── icons/               PWA icons (192, 512, maskable 512)
└── README.md
```

## Deploy (GitHub + Cloudflare Pages)

1. Put these files at the root of a GitHub repository.
2. In Cloudflare, create a Pages project from the repo. Leave the build command empty and set the output directory to `/`.
3. Visit the site once online, then use **About → Install App**.

## Customising

- **Occupations:** edit the `OCCUPATIONS` object at the top of `app.js` (label → Wikidata Q-code). Check any new Q-code at wikidata.org first.
- **Offline updates:** after changing any cached file, bump `VERSION` in `sw.js` so installed copies refresh.
- **Preview image:** replace `preview.png` with your own 1200x630 artwork.

## Credits

Powered by Wikidata and the MediaWiki REST API. Text and images belong to their Wikimedia contributors under their original licenses.
