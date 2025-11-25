import { csvParse } from 'https://esm.sh/d3-dsv';

// =======================
// Configuration
// =======================
const OPACITY = 0.4;

const AIRPORT_COLOR = '#8ddcff';          // Unselected airport color
const AIRPORT_SELECTED_COLOR = '#991933'; // Selected airport color
const ROUTE_COLOR = '#ffffff';

const DEFAULT_RADIUS = 0.3; // Initial / selected radius
const SHRINK_RADIUS = 0.2;  // Radius for non-selected airports

const WORLD_LABEL_LIMIT = 250; // Max airports with labels in full-world mode

// =======================
// Global Data Containers
// =======================
let AIRPORTS = [];
let ROUTES = [];
let selectedAirport = null;        // currently selected airport object
let selectedRoute = null;          // currently selected route object
let VISIBLE_AIRPORTS = [];         // airports currently rendered as points
let HTML_LABEL_AIRPORTS = [];      // airports that get HTML labels

// =======================
// Helpers
// =======================

// Try to find a numeric seat-count field on the row
function getSeatValue(a) {
    const candidates = ['flights', 'Flights'];
    for (const key of candidates) {
        if (a[key] !== undefined && a[key] !== null && !isNaN(+a[key])) {
            return +a[key];
        }
    }
    return 0;
}

// Pick the largest airports by seat count (for full-world labels)
function getTopAirportsByFlights(airports, maxCount) {
    if (!airports.length) return [];

    const withFlights = [...airports];
    withFlights.sort((a, b) => getSeatValue(b) - getSeatValue(a)); // descending
    return withFlights.slice(0, maxCount);
}

// Safely choose an IATA-ish label
function getIataCode(a) {
    return a.iata || a.IATA || a.code || a.Code || '';
}
// Read size category from CSV row: Mega, Large, Medium, Small, Regional
function getSizeCategory(a) {
    const candidates = ['category', 'Category', 'size', 'Size', 'class', 'Class'];
    for (const key of candidates) {
        if (a[key]) return a[key];
    }
    return 'Medium'; // fallback
}

function getBaseRadius(a) {
    const cat = (getSizeCategory(a) || '').toLowerCase();

    switch (cat) {
        case 'mega':
            return 0.5;   // as requested
        case 'large':
            return 0.4;
        case 'medium':
            return 0.3;
        case 'small':
            return 0.22;
        case 'regional':
            return 0.18;
        case 'outpost':
            return 0.15;
        default:
            return 0.15;   // fallback
    }
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
        const base = getBaseRadius(d);

        if (selectedAirport === null) {
            // No selection: use size-based radius only
            return base;
        }

        // When there's a selected airport:
        // - selected airport keeps its full size
        // - others shrink relative to their base size
        return d === selectedAirport ? base : base * 0.5;
    })


    .pointAltitude(d => {
        if (selectedAirport === null) {
            // Initial state: all slightly raised
            return 0.005;
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
    .onArcHover(hoverRoute => {
        if (selectedRoute) return; // Don't interfere if a route is locked

        globe.arcColor(d => {
            if (d === hoverRoute) return '#ffd700'; // Gold highlight
            return ROUTE_COLOR;
        });

        // Optional: thicken hovered route
        globe.arcStroke(d => d === hoverRoute ? 0.5 : 0.25);
    })
    .onArcClick(handleRouteClick)

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
        div.style.background = 'rgba(0, 0, 0, 0.5)'; // black backdrop
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

function updateVisualization() {
    // Clear selection
    selectedAirport = null;
    globe.arcsData([]);

    const category = document.getElementById('category-filter')?.value || '';
    const searchTerm = (document.getElementById('search-input')?.value || '').toLowerCase().trim();

    VISIBLE_AIRPORTS = AIRPORTS.filter(a => {
        // 1. Category Filter
        if (category && getSizeCategory(a) !== category) return false;

        // 2. Search Filter (IATA or Name)
        if (searchTerm) {
            const iata = getIataCode(a).toLowerCase();
            const name = (a.name || '').toLowerCase();
            if (!iata.includes(searchTerm) && !name.includes(searchTerm)) return false;
        }

        return true;
    });

    globe.pointsData(VISIBLE_AIRPORTS);

    // Update labels based on visible set
    HTML_LABEL_AIRPORTS = getTopAirportsByFlights(VISIBLE_AIRPORTS, WORLD_LABEL_LIMIT);
    globe.htmlElementsData(HTML_LABEL_AIRPORTS);
}

function updateSuggestions(searchTerm) {
    const suggestionsEl = document.getElementById('search-suggestions');
    if (!suggestionsEl) return;

    // Hide if empty
    if (!searchTerm || searchTerm.length < 2) {
        suggestionsEl.style.display = 'none';
        return;
    }

    // Filter matches (limit to 10)
    const matches = AIRPORTS.filter(a => {
        const iata = getIataCode(a).toLowerCase();
        const name = (a.name || '').toLowerCase();
        return iata.includes(searchTerm) || name.includes(searchTerm);
    }).slice(0, 10);

    if (matches.length === 0) {
        suggestionsEl.style.display = 'none';
        return;
    }

    // Generate HTML
    suggestionsEl.innerHTML = '';
    matches.forEach(a => {
        const div = document.createElement('div');
        div.className = 'suggestion-item';
        div.innerHTML = `<span class="iata">${getIataCode(a)}</span> ${a.name}`;

        div.addEventListener('click', () => {
            // Set input value
            const searchInput = document.getElementById('search-input');
            if (searchInput) {
                searchInput.value = getIataCode(a);
            }
            suggestionsEl.style.display = 'none';

            // Trigger full selection logic
            handleAirportClick(a);
        });

        suggestionsEl.appendChild(div);
    });

    suggestionsEl.style.display = 'block';
}

function updateRouteSuggestions(searchTerm) {
    const suggestionsEl = document.getElementById('route-search-suggestions');
    if (!suggestionsEl) return;

    // Hide if empty
    if (!searchTerm || searchTerm.length < 3) {
        suggestionsEl.style.display = 'none';
        return;
    }

    // Filter matches (limit to 10)
    // Matches "SRC-DST" format
    const matches = ROUTES.filter(r => {
        const routeStr = `${r.srcIata}-${r.dstIata}`.toLowerCase();
        return routeStr.includes(searchTerm);
    }).slice(0, 10);

    if (matches.length === 0) {
        suggestionsEl.style.display = 'none';
        return;
    }

    // Generate HTML
    suggestionsEl.innerHTML = '';
    matches.forEach(r => {
        const div = document.createElement('div');
        div.className = 'suggestion-item';
        div.innerHTML = `<span class="iata">${r.srcIata}-${r.dstIata}</span>`;

        div.addEventListener('click', () => {
            // Set input value
            const searchInput = document.getElementById('route-search-input');
            if (searchInput) {
                searchInput.value = `${r.srcIata}-${r.dstIata}`;
            }
            suggestionsEl.style.display = 'none';

            // Trigger full selection logic
            // We need to construct the full route object with coords
            const src = AIRPORTS.find(a => a.iata === r.srcIata);
            const dst = AIRPORTS.find(a => a.iata === r.dstIata);

            if (src && dst) {
                const fullRoute = {
                    startLat: parseFloat(src.lat),
                    startLng: parseFloat(src.lng),
                    endLat: parseFloat(dst.lat),
                    endLng: parseFloat(dst.lng),
                    ...r
                };
                handleRouteClick(fullRoute);
            }
        });

        suggestionsEl.appendChild(div);
    });

    suggestionsEl.style.display = 'block';
}

function resetView() {
    // Reset dropdown
    const select = document.getElementById('category-filter');
    if (select) select.value = '';

    // Reset search
    const search = document.getElementById('search-input');
    if (search) search.value = '';

    // Apply empty filter (resets everything)
    updateVisualization();

    // Reset camera
    globe.pointOfView(
        {
            lat: Number(route.startLat),
            lng: Number(route.startLng),
            altitude: 0.5
        },
        2000
    );

    // Reset Route Info
    selectedRoute = null;
    const routeInfo = document.getElementById('route-info-panel');
    if (routeInfo) routeInfo.style.display = 'none';

    // Clear route search
    const routeSearch = document.getElementById('route-search-input');
    if (routeSearch) routeSearch.value = '';
}

function handleRouteClick(route) {
    if (!route) return;

    selectedRoute = route;
    console.log('Clicked route:', route);

    // Highlight this route permanently (until reset/click elsewhere)
    globe.arcColor(d => {
        // Match by src/dst to be safe
        if (d.srcIata === route.srcIata && d.dstIata === route.dstIata) return '#ffd700';
        return 'rgba(255, 255, 255, 0.1)'; // Dim others
    });
    globe.arcStroke(d => {
        if (d.srcIata === route.srcIata && d.dstIata === route.dstIata) return 0.8;
        return 0.1;
    });

    // Show Info Panel
    const panel = document.getElementById('route-info-panel');
    if (panel) {
        document.getElementById('route-title').textContent = `${route.srcIata} - ${route.dstIata}`;
        document.getElementById('route-flights').textContent = route.flights || '-';
        document.getElementById('route-stage').textContent = route.stage ? `${route.stage} mi` : '-';
        document.getElementById('route-duration').textContent = route.duration ? `${route.duration} hr` : '-';

        panel.style.display = 'block';
    }

    // Ensure the route is visible on the map
    globe.arcsData([route]);

    // Also ensure source/dest airports are visible
    const src = AIRPORTS.find(a => a.iata === route.srcIata);
    const dst = AIRPORTS.find(a => a.iata === route.dstIata);
    if (src && dst) {
        VISIBLE_AIRPORTS = [src, dst];
        globe.pointsData(VISIBLE_AIRPORTS);

        // Update labels
        HTML_LABEL_AIRPORTS = VISIBLE_AIRPORTS;
        globe.htmlElementsData(HTML_LABEL_AIRPORTS);
    }

    // Focus camera on midpoint? Or just let user explore.
    // Let's focus on the source airport for context
    globe.pointOfView({
        lat: route.startLat,
        lng: route.startLng,
        altitude: 0.5
    }, 1000);
}

function handleAirportClick(airport) {
    if (!airport) return;

    const isSameAirport = airport === selectedAirport;

    if (isSameAirport) {
        // 🔄 Toggle off: re-apply current filter (which clears selection)
        updateVisualization();
        return;
    }

    // 🟥 New selection
    selectedAirport = airport;
    console.log('Clicked airport:', airport);

    // Sync with search bar
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.value = getIataCode(airport);
    }

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

    // Reset any previous route selection when clicking a new airport
    selectedRoute = null;
    const routeInfo = document.getElementById('route-info-panel');
    if (routeInfo) routeInfo.style.display = 'none';

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
        const rawRoutes = csvParse(routesText);

        // Clean up route keys (trim whitespace from headers)
        ROUTES = rawRoutes.map(r => {
            const newR = {};
            Object.keys(r).forEach(k => {
                newR[k.trim()] = r[k];
            });
            return newR;
        });

        console.log(`Loaded ${AIRPORTS.length} airports and ${ROUTES.length} routes.`);

        // Initial render: all airports visible
        VISIBLE_AIRPORTS = AIRPORTS;
        globe.pointsData(VISIBLE_AIRPORTS);

        // Initial labels: top N airports by flights
        HTML_LABEL_AIRPORTS = getTopAirportsByFlights(AIRPORTS, WORLD_LABEL_LIMIT);
        globe.htmlElementsData(HTML_LABEL_AIRPORTS);

        console.log('Initial labels:', HTML_LABEL_AIRPORTS.length);

        const loadingEl = document.getElementById('loading');
        if (loadingEl) loadingEl.style.display = 'none';

        // Set initial camera position
        globe.pointOfView({ lat: 35, lng: -90, altitude: 1 }, 0);

        // Populate Category Dropdown
        const categories = new Set(AIRPORTS.map(a => getSizeCategory(a)));
        const sortedCategories = [...categories].sort();
        const select = document.getElementById('category-filter');
        if (select) {
            sortedCategories.forEach(cat => {
                const opt = document.createElement('option');
                opt.value = cat;
                opt.textContent = cat;
                select.appendChild(opt);
            });
        }
    } catch (err) {
        console.error('Error loading data:', err);
        const loadingEl = document.getElementById('loading');
        if (loadingEl) {
            loadingEl.textContent = 'Error loading data. See console.';
            loadingEl.style.color = 'red';

            if (window.location.protocol === 'file:') {
                alert('Error: Cannot load data when opening via file://. Please run a local server (e.g., python -m http.server).');
            }
        }
    }
}

// =======================
// Start
// =======================

// Attach listeners immediately
const select = document.getElementById('category-filter');
if (select) {
    select.addEventListener('change', updateVisualization);
}
const searchInput = document.getElementById('search-input');
if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        updateVisualization();
        updateSuggestions(e.target.value.toLowerCase().trim());
    });

    // Hide suggestions on focus out (delayed to allow click)
    // Better: click outside listener
    document.addEventListener('click', (e) => {
        const suggestionsEl = document.getElementById('search-suggestions');
        if (suggestionsEl && !e.target.closest('#search-wrapper')) {
            suggestionsEl.style.display = 'none';
        }
    });
}

const routeSearchInput = document.getElementById('route-search-input');
if (routeSearchInput) {
    routeSearchInput.addEventListener('input', (e) => {
        updateRouteSuggestions(e.target.value.toLowerCase().trim());
    });

    document.addEventListener('click', (e) => {
        const suggestionsEl = document.getElementById('route-search-suggestions');
        if (suggestionsEl && !e.target.closest('#route-search-wrapper')) {
            suggestionsEl.style.display = 'none';
        }
    });
}
const resetBtn = document.getElementById('reset-btn');
if (resetBtn) {
    resetBtn.addEventListener('click', resetView);
}

loadData();
