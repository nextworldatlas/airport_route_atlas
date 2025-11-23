import { csvParse } from 'https://esm.sh/d3-dsv';

// Configuration
const OPACITY = 0.4;
const AIRPORT_COLOR = '#00e5ff'; // Cyan/Teal
const AIRPORT_SELECTED_COLOR = '#ff0055'; // Pink/Red
const ROUTE_COLOR = ['rgba(0, 229, 255, 0.5)', 'rgba(255, 0, 85, 0.5)']; // Gradient

// Global Data Containers
let AIRPORTS = [];
let ROUTES = [];

// Initialize Globe
const globe = Globe()
    (document.getElementById('globeViz'))
    .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
    .backgroundImageUrl('https://unpkg.com/three-globe/example/img/night-sky.png')

    // Points (Airports)
    .pointColor(() => AIRPORT_COLOR)
    .pointAltitude(0.02) // Slightly raised
    .pointRadius(0.5) // Larger for visibility
    .pointLabel(d => `<b>${d.name} (${d.iata})</b><br>${d.country}`) // Hover label
    .onPointClick(handleAirportClick)

    // Arcs (Routes)
    .arcColor(() => ROUTE_COLOR)
    .arcDashLength(0.4)
    .arcDashGap(0.2)
    .arcDashAnimateTime(0) // Static
    .arcStroke(0.5)
    .arcsData([]); // Start empty

// Tile Engine Setup
const SATELLITE_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
globe.globeTileEngineUrl((x, y, z) => SATELLITE_TILES.replace('{z}', z).replace('{x}', x).replace('{y}', y));

// Interaction Handler
function handleAirportClick(airport) {
    if (!airport) return;

    console.log("Clicked airport:", airport);

    // Find routes starting from this airport
    const activeRoutes = ROUTES.filter(r => r.srcIata === airport.iata).map(r => {
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
    }).filter(r => r !== null);

    console.log("Found routes:", activeRoutes);

    // Update Globe Arcs
    globe.arcsData(activeRoutes);

    // Optional: Focus camera
    globe.pointOfView({ lat: parseFloat(airport.lat), lng: parseFloat(airport.lng), altitude: 1.5 }, 1000);
}

// Data Loading
async function loadData() {
    try {
        const [airportsText, routesText] = await Promise.all([
            fetch('airports.csv').then(res => res.text()),
            fetch('routes.csv').then(res => res.text())
        ]);

        AIRPORTS = csvParse(airportsText);
        ROUTES = csvParse(routesText);

        console.log(`Loaded ${AIRPORTS.length} airports and ${ROUTES.length} routes.`);

        // Initial Render
        globe.pointsData(AIRPORTS);

        document.getElementById('loading').style.display = 'none';

    } catch (err) {
        console.error("Error loading data:", err);
        document.getElementById('loading').textContent = "Error loading data.";
    }
}

// Start
loadData();
