import { csvParse } from 'https://esm.sh/d3-dsv';

// =======================
// Configuration
// =======================
const OPACITY = 0.4;
const AIRPORT_COLOR = '#8ddcff';          // Unselected airport color
const AIRPORT_SELECTED_COLOR = '#991933'; // Selected airport color
const ROUTE_COLOR = '#ffffff';

const DEFAULT_RADIUS = 0.5; // Initial/selected radius
const SHRINK_RADIUS = 0.2;  // Radius for non-selected airports

// =======================
// Global Data Containers
// =======================
let AIRPORTS = [];
let ROUTES = [];
let selectedAirport = null;      // Currently selected airport object
let VISIBLE_AIRPORTS = [];       // Subset currently rendered

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

    .pointLabel(d => `<b>${d.name} (${d.iata})</b><br>${d.country}`)
    .onPointClick(handleAirportClick)

    // Arcs (Routes)
    .arcColor(() => ROUTE_COLOR)
    .arcDashLength(1)
    .arcDashGap(0)
    .arcDashAnimateTime(0)
    .arcStroke(0.25)
    .arcsData([]);

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
        // 🔄 Toggle off: clear selection and routes, restore all airports
        selectedAirport = null;
        globe.arcsData([]);
        VISIBLE_AIRPORTS = AIRPORTS;
        globe.pointsData(VISIBLE_AIRPORTS);
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

    console.log('Found routes:', activeRoutes);

    // Update arcs on globe
    globe.arcsData(activeRoutes);

    // ⚡ Compute which airports have a route "touching" the selected airport
    const connectedIatas = new Set();
    connectedIatas.add(airport.iata);
    activeRoutes.forEach(r => {
        connectedIatas.add(r.srcIata);
        connectedIatas.add(r.dstIata);
    });

    // Keep only selected + connected airports
    VISIBLE_AIRPORTS = AIRPORTS.filter(a => connectedIatas.has(a.iata));

    // Re-render points with filtered list
    globe.pointsData(VISIBLE_AIRPORTS);

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

        // Initial render = all airports visible
        VISIBLE_AIRPORTS = AIRPORTS;
        globe.pointsData(VISIBLE_AIRPORTS);

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
