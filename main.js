import { csvParse } from 'https://esm.sh/d3-dsv';

// =======================
// Configuration
// =======================
const OPACITY = 0.4;

const AIRPORT_COLOR = '#8ddcff';          // Unselected airport color
const AIRPORT_SELECTED_COLOR = '#991933'; // Selected airport color
const ROUTE_COLOR = '#ffffff';

const DEFAULT_RADIUS = 0.5; // Initial / selected radius
const SHRINK_RADIUS = 0.2;  // Radius for non-selected airports

const WORLD_LABEL_LIMIT = 250; // Max airports with labels in full-world mode

// =======================
// Global Data Containers
// =======================
let AIRPORTS = [];
let ROUTES = [];
let selectedAirport = null;        // currently selected airport object
let VISIBLE_AIRPORTS = [];         // airports currently rendered as points
let HTML_LABEL_AIRPORTS = [];      // airports that get HTML labels

// =======================
// Helpers
// =======================

// Try to find a numeric seat-count field on the row
function getSeatValue(a) {
    const candidates = ['seats', 'Seats', 'total_seats', 'TotalSeats', 'SEATS'];
    for (const key of candidates) {
        if (a[key] !== undefined && a[key] !== null && !isNaN(+a[key])) {
            return +a[key];
        }
    }
    return 0;
}

// Pick the largest airports by seat count (for full-world labels)
function getTopAirportsBySeats(airports, maxCount) {
    if (!airports.length) return [];

    const withSeats = [...airports];
    withSeats.sort((a, b) => getSeatValue(b) - getSeatValue(a)); // descending
    return withSeats.slice(0, maxCount);
}

// Safely choose an IATA-ish label
function getIataCode(a) {
    return a.iata || a.IATA || a.code || a.Code || '';
}

// =======================
// Initialize Globe
// =======================
const globe = Globe()
    (document.getElementById('globeViz'))
    .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
    .backgroundImageUrl('https://unpkg.com/three-globe/example/img/night-sky.png')

    // Points (Airports)
    .pointColor(d =>
        d === selectedAirport ? AIRPORT_SELECTED_COLOR : AIRPORT_COLOR
    )

    .pointRadius(d => {
        if (selectedAirport === null) {
            // No selection yet – all same size
            return DEFAULT_RADIUS;
        }
        // Selected stays default size, others shrink
        return d === selectedAirport ? DEFAULT_RADIUS : SHRINK_RADIUS;
    })

    .pointAltitude(d => {
        if (selectedAirport === null) {
            // Initial state: all slightly raised
            return 0.02;
        }
        // Selected stays raised, others nearly flat
        return d === selectedAirport ? 0.02 : 0.01;
    })

    .pointLabel(d => `<b>${d.name} (${getIataCode(d)})</b><br>${d.country}`)
    .onPointClick(handleAirportClick)

    // Arcs (Routes)
    .arcColor(() => ROUTE_COLOR)
    .arcDashLength(1)
    .arcDashGap(0)
    .arcDashAnimateTime(0)
    .arcStroke(0.25)
    .arcsData([])

    // =======================
    // HTML Labels (black background + glow)
    // =======================
    .htmlElementsData(HTML_LABEL_AIRPORTS)
    .htmlLat(d => +d.lat)
    .htmlLng(d => +d.lng)
    .htmlAltitude(d => {
        // Pop the hub label slightly higher when selected
        if (selectedAirport && d === selectedAirport) return 0.04;
        return 0.03;
    })
    .htmlElement(d => {
        const code = getIataCode(d);
        if (!code) return null;

        const div = document.createElement('div');
        div.textContent = code;

        // Base look
        div.style.background = 'rgba(0, 0, 0, 0.8)'; // black backdrop
        div.style.color = 'white';
        div.style.padding = '2px 6px';
        div.style.borderRadius = '4px';
        div.style.display = 'inline-block';
        div.style.pointerEvents = 'none';

        // Glow and readability
        div.style.boxShadow = '0 0 8px rgba(0, 0, 0, 0.9)';
        div.style.textShadow = '0 0 4px rgba(0, 0, 0, 0.9)';

        // Size & emphasis
        if (d === selectedAirport) {
            div.style.fontSize = '14px';
            div.style.fontWeight = '700';
            div.style.border = '1px solid rgba(255, 255, 255, 0.9)';
        } else {
            div.style.fontSize = '11px';
            div.style.fontWeight = '500';
        }

        return div;
    });

// =======================
// Tile Engine Setup
// =======================
const SATELLITE_TILES =
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

globe.globeTileEngineUrl((x, y, z) =>
    SATELLITE_TILES.replace('{z}', z).replace('{x}', x).replace('{y}', y)
);

// =======================
// Interaction Handler
// =======================
function handleAirportClick(airport) {
    if (!airport) return;

    const isSameAirport = airport === selectedAirport;

    if (isSameAirport) {
        // 🔄 Toggle off: clear selection and routes, restore all airports and world labels
        selectedAirport = null;
        globe.arcsData([]);

        VISIBLE_AIRPORTS = AIRPORTS;
        HTML_LABEL_AIRPORTS = getTopAirportsBySeats(AIRPORTS, WORLD_LABEL_LIMIT);

        globe.pointsData(VISIBLE_AIRPORTS);
        globe.htmlElementsData(HTML_LABEL_AIRPORTS);

        console.log('Reset to world view. Labels:', HTML_LABEL_AIRPORTS.length);
        return;
    }

    // 🟥 New selection
    selectedAirport = airport;
    console.log('Clicked airport:', airport);

    // Build outbound routes from this airport
    const activeRoutes = ROUTES
        .filter(r => r.srcIata === airport.iata)
        .map(r => {
            const src = AIRPORTS.find(a => a.iata === r.srcIata);
            const dst = AIRPORTS.find(a => a.iata === r.dstIata);
            if (!src || !dst) return null;

            return {
                startLat: parseFloat(src.lat),
                startLng: parseFloat(src.lng),
                endLat: parseFloat(dst.lat),
                endLng: parseFloat(dst.lng),
                ...r
            };
        })
        .filter(r => r !== null);

    console.log('Found routes:', activeRoutes.length);

    // Update arcs on globe
    globe.arcsData(activeRoutes);

    // Compute which airports have a route "touching" the selected airport
    const connectedIatas = new Set();
    connectedIatas.add(airport.iata);
    activeRoutes.forEach(r => {
        connectedIatas.add(r.srcIata);
        connectedIatas.add(r.dstIata);
    });

    // Keep only selected + connected airports as points
    VISIBLE_AIRPORTS = AIRPORTS.filter(a => connectedIatas.has(a.iata));
    globe.pointsData(VISIBLE_AIRPORTS);

    // In hub mode: label hub + all spokes
    HTML_LABEL_AIRPORTS = VISIBLE_AIRPORTS;
    globe.htmlElementsData(HTML_LABEL_AIRPORTS);

    console.log('Hub view. Visible airports:', VISIBLE_AIRPORTS.length);

    // Focus camera on selected airport
    globe.pointOfView(
        {
            lat: parseFloat(airport.lat),
            lng: parseFloat(airport.lng),
            altitude: 1.5
        },
        1000
    );
}

// =======================
// Data Loading
// =======================
async function loadData() {
    try {
        const [airportsText, routesText] = await Promise.all([
            fetch('airports.csv').then(res => res.text()),
            fetch('routes.csv').then(res => res.text())
        ]);

        AIRPORTS = csvParse(airportsText);
        ROUTES = csvParse(routesText);

        console.log(`Loaded ${AIRPORTS.length} airports and ${ROUTES.length} routes.`);

        // Initial render: all airports visible
        VISIBLE_AIRPORTS = AIRPORTS;
        globe.pointsData(VISIBLE_AIRPORTS);

        // Initial labels: top N airports by seats
        HTML_LABEL_AIRPORTS = getTopAirportsBySeats(AIRPORTS, WORLD_LABEL_LIMIT);
        globe.htmlElementsData(HTML_LABEL_AIRPORTS);

        console.log('Initial labels:', HTML_LABEL_AIRPORTS.length);

        const loadingEl = document.getElementById('loading');
        if (loadingEl) loadingEl.style.display = 'none';
    } catch (err) {
        console.error('Error loading data:', err);
        const loadingEl = document.getElementById('loading');
        if (loadingEl) loadingEl.textContent = 'Error loading data.';
    }
}

// =======================
// Start
// =======================
loadData();
