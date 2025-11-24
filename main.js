import { csvParse } from 'https://esm.sh/d3-dsv';

// Configuration
const OPACITY = 0.4;
const AIRPORT_COLOR = '#8ddcff'; // Cyan/Teal (Unselected Color)
const AIRPORT_SELECTED_COLOR = '#991933'; // Pink/Red (Selected Color)
const ROUTE_COLOR = '#ffffff';
const DEFAULT_RADIUS = 0.5; // Initial/Unselected Radius
const SHRINK_RADIUS = 0.2; // Radius for non-selected airports

// Global Data Containers
let AIRPORTS = [];
let ROUTES = [];
let selectedAirport = null; // Variable to track the currently selected airport

// Initialize Globe
const globe = Globe()
    (document.getElementById('globeViz'))
    .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
    .backgroundImageUrl('https://unpkg.com/three-globe/example/img/night-sky.png')

    // Points (Airports)
    .pointColor(d => d === selectedAirport ? AIRPORT_SELECTED_COLOR : AIRPORT_COLOR)
    .pointAltitude(0.02) // Slightly raised

    // Dynamic Radius logic:
    .pointRadius(d => {
        if (selectedAirport === null) {
            // No airport selected, all are default size
            return DEFAULT_RADIUS;
        } else if (d === selectedAirport) {
            // The selected airport is its default size
            return DEFAULT_RADIUS;
        } else {
            // Other airports shrink
            return SHRINK_RADIUS;
        }
    })

    .pointLabel(d => `<b>${d.name} (${d.iata})</b><br>${d.country}`) // Hover label
    .onPointClick(handleAirportClick)

    // Arcs (Routes)
    .arcColor(() => ROUTE_COLOR)
    .arcDashLength(1)
    .arcDashGap(0)
    .arcDashAnimateTime(0) // Static
    .arcStroke(0.25)
    .arcsData([]); // Start empty

// Tile Engine Setup
const SATELLITE_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
globe.globeTileEngineUrl((x, y, z) => SATELLITE_TILES.replace('{z}', z).replace('{x}', x).replace('{y}', y));

// Interaction Handler
function handleAirportClick(airport) {
    if (!airport) return;

    // Check if the same airport was clicked (for unselecting/toggling)
    const isSameAirport = airport === selectedAirport;

    if (isSameAirport) {
        // Unselect the airport
        selectedAirport = null;
        globe.arcsData([]); // Clear routes
    } else {
        // Select the new airport
        selectedAirport = airport;

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

    // Trigger points redraw to update both colors and sizes
    // Calling pointsData with the existing array forces a redraw and re-evaluation of pointColor and pointRadius
    globe.pointsData(AIRPORTS);
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