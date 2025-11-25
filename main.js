import { csvParse } from 'https://esm.sh/d3-dsv';

// =======================
// Configuration
// =======================
const CONFIG = {
    OPACITY: 0.4,
    AIRPORT_COLOR: '#8ddcff',
    AIRPORT_SELECTED_COLOR: '#991933',
    ROUTE_COLOR: '#ffffff',
    ROUTE_HIGHLIGHT_COLOR: '#ffd700',
    DEFAULT_RADIUS: 0.3,
    SHRINK_RADIUS: 0.2,
    WORLD_LABEL_LIMIT: 250,
    SATELLITE_TILES: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    CATEGORY_ORDER: ['Mega', 'Large', 'Medium', 'Small', 'Regional', 'Outpost']
};

// =======================
// Global State
// =======================
let AIRPORTS = [];
let ROUTES = [];
let selectedAirport = null;
let selectedRoute = null;
let VISIBLE_AIRPORTS = [];
let HTML_LABEL_AIRPORTS = [];

// =======================
// Helpers
// =======================

function getSeatValue(a) {
    const candidates = ['flights', 'Flights'];
    for (const key of candidates) {
        if (a[key] !== undefined && a[key] !== null && !isNaN(+a[key])) {
            return +a[key];
        }
    }
    return 0;
}

function getTopAirportsByFlights(airports, maxCount) {
    if (!airports.length) return [];
    return [...airports]
        .sort((a, b) => getSeatValue(b) - getSeatValue(a))
        .slice(0, maxCount);
}

function getIataCode(a) {
    return a.iata || a.IATA || a.code || a.Code || '';
}

function getSizeCategory(a) {
    const candidates = ['category', 'Category', 'size', 'Size', 'class', 'Class'];
    for (const key of candidates) {
        if (a[key]) return a[key];
    }
    return 'Medium';
}

function getBaseRadius(a) {
    const cat = (getSizeCategory(a) || '').toLowerCase();
    const sizes = {
        mega: 0.5,
        large: 0.4,
        medium: 0.3,
        small: 0.22,
        regional: 0.18,
        outpost: 0.15
    };
    return sizes[cat] || 0.15;
}

// =======================
// Globe Initialization
// =======================
const globe = Globe()
    (document.getElementById('globeViz'))
    .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
    .backgroundImageUrl('https://unpkg.com/three-globe/example/img/night-sky.png')
    .globeTileEngineUrl((x, y, z) =>
        CONFIG.SATELLITE_TILES.replace('{z}', z).replace('{x}', x).replace('{y}', y)
    )

    // Points (Airports)
    .pointColor(d => d === selectedAirport ? CONFIG.AIRPORT_SELECTED_COLOR : CONFIG.AIRPORT_COLOR)
    .pointRadius(d => {
        const base = getBaseRadius(d);
        if (!selectedAirport) return base;
        return d === selectedAirport ? base : base * 0.5;
    })
    .pointAltitude(d => {
        const base = getBaseRadius(d);
        const altitude = base * 0.05; // Proportional to radius
        return d === selectedAirport ? altitude * 1.5 : altitude;
    })
    .pointLabel(d => `<b>${d.name} (${getIataCode(d)})</b><br>${d.country}`)
    .onPointClick(handleAirportClick)

    // Arcs (Routes)
    .arcColor(() => CONFIG.ROUTE_COLOR)
    .arcDashLength(1)
    .arcDashGap(0)
    .arcDashAnimateTime(0)
    .arcStroke(0.25)
    .arcsData([])
    .onArcHover(handleRouteHover)
    .onArcClick(handleRouteClick)

    // HTML Labels
    .htmlElementsData([])
    .htmlLat(d => +d.lat)
    .htmlLng(d => +d.lng)
    .htmlAltitude(d => {
        const base = getBaseRadius(d);
        const altitude = base * 0.05;
        const finalAlt = d === selectedAirport ? altitude * 1.5 : altitude;
        return finalAlt + 0.005; // Just above the marker
    })
    .htmlElement(createLabelElement);

function createLabelElement(d) {
    const code = getIataCode(d);
    if (!code) return null;

    const div = document.createElement('div');
    div.textContent = code;
    Object.assign(div.style, {
        background: 'rgba(0, 0, 0, 0.5)',
        color: 'white',
        padding: '2px 6px',
        borderRadius: '4px',
        display: 'inline-block',
        pointerEvents: 'none',
        boxShadow: '0 0 8px rgba(0, 0, 0, 0.9)',
        textShadow: '0 0 4px rgba(0, 0, 0, 0.9)',
        fontSize: d === selectedAirport ? '14px' : '11px',
        fontWeight: d === selectedAirport ? '700' : '500',
        border: d === selectedAirport ? '1px solid rgba(255, 255, 255, 0.9)' : 'none'
    });
    return div;
}

// =======================
// Interaction Handlers
// =======================

function handleRouteHover(hoverRoute) {
    if (selectedRoute) return; // Don't interfere if a route is locked

    globe.arcColor(d => d === hoverRoute ? CONFIG.ROUTE_HIGHLIGHT_COLOR : CONFIG.ROUTE_COLOR);
    globe.arcStroke(d => d === hoverRoute ? 0.5 : 0.25);
}

function updateVisualization() {
    selectedAirport = null;
    globe.arcsData([]);

    const category = document.getElementById('category-filter')?.value || '';
    const searchTerm = (document.getElementById('search-input')?.value || '').toLowerCase().trim();

    VISIBLE_AIRPORTS = AIRPORTS.filter(a => {
        if (category && getSizeCategory(a) !== category) return false;
        if (searchTerm) {
            const iata = getIataCode(a).toLowerCase();
            const name = (a.name || '').toLowerCase();
            if (!iata.includes(searchTerm) && !name.includes(searchTerm)) return false;
        }
        return true;
    });

    globe.pointsData(VISIBLE_AIRPORTS);
    HTML_LABEL_AIRPORTS = getTopAirportsByFlights(VISIBLE_AIRPORTS, CONFIG.WORLD_LABEL_LIMIT);
    globe.htmlElementsData(HTML_LABEL_AIRPORTS);
}

function createSuggestions(searchTerm, type) {
    const wrapperId = type === 'route' ? 'route-search-suggestions' : 'search-suggestions';
    const inputId = type === 'route' ? 'route-search-input' : 'search-input';
    const suggestionsEl = document.getElementById(wrapperId);

    if (!suggestionsEl) return;

    if (!searchTerm || searchTerm.length < (type === 'route' ? 3 : 2)) {
        suggestionsEl.style.display = 'none';
        return;
    }

    let matches = [];
    if (type === 'route') {
        matches = ROUTES.filter(r => `${r.srcIata}-${r.dstIata}`.toLowerCase().includes(searchTerm)).slice(0, 10);
    } else {
        matches = AIRPORTS.filter(a => {
            const iata = getIataCode(a).toLowerCase();
            const name = (a.name || '').toLowerCase();
            return iata.includes(searchTerm) || name.includes(searchTerm);
        }).slice(0, 10);
    }

    if (matches.length === 0) {
        suggestionsEl.style.display = 'none';
        return;
    }

    suggestionsEl.innerHTML = '';
    matches.forEach(item => {
        const div = document.createElement('div');
        div.className = 'suggestion-item';

        if (type === 'route') {
            div.innerHTML = `<span class="iata">${item.srcIata}-${item.dstIata}</span>`;
            div.addEventListener('click', () => {
                document.getElementById(inputId).value = `${item.srcIata}-${item.dstIata}`;
                suggestionsEl.style.display = 'none';

                const src = AIRPORTS.find(a => a.iata === item.srcIata);
                const dst = AIRPORTS.find(a => a.iata === item.dstIata);
                if (src && dst) {
                    handleRouteClick({
                        startLat: parseFloat(src.lat),
                        startLng: parseFloat(src.lng),
                        endLat: parseFloat(dst.lat),
                        endLng: parseFloat(dst.lng),
                        ...item
                    });
                }
            });
        } else {
            div.innerHTML = `<span class="iata">${getIataCode(item)}</span> ${item.name}`;
            div.addEventListener('click', () => {
                document.getElementById(inputId).value = getIataCode(item);
                suggestionsEl.style.display = 'none';
                handleAirportClick(item);
            });
        }
        suggestionsEl.appendChild(div);
    });

    suggestionsEl.style.display = 'block';
}

function resetView() {
    ['category-filter', 'search-input', 'route-search-input'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });

    updateVisualization();
    globe.pointOfView({ lat: 35, lng: -90, altitude: 1 }, 2000);

    selectedRoute = null;
    const routeInfo = document.getElementById('route-info-panel');
    if (routeInfo) routeInfo.style.display = 'none';
}

function handleRouteClick(route) {
    if (!route) return;

    selectedRoute = route;
    console.log('Clicked route:', route);

    // Highlight route
    globe.arcColor(d => (d.srcIata === route.srcIata && d.dstIata === route.dstIata) ? CONFIG.ROUTE_HIGHLIGHT_COLOR : 'rgba(255, 255, 255, 0.1)');
    globe.arcStroke(d => (d.srcIata === route.srcIata && d.dstIata === route.dstIata) ? 0.8 : 0.1);

    // Update Info Panel
    const panel = document.getElementById('route-info-panel');
    if (panel) {
        document.getElementById('route-title').textContent = `${route.srcIata} - ${route.dstIata}`;
        document.getElementById('route-flights').textContent = route.flights || '-';
        document.getElementById('route-stage').textContent = route.stage ? `${route.stage} mi` : '-';
        document.getElementById('route-duration').textContent = route.duration ? `${route.duration} hr` : '-';
        panel.style.display = 'block';
    }

    // Ensure visibility
    globe.arcsData([route]);
    const src = AIRPORTS.find(a => a.iata === route.srcIata);
    const dst = AIRPORTS.find(a => a.iata === route.dstIata);

    if (src && dst) {
        VISIBLE_AIRPORTS = [src, dst];
        globe.pointsData(VISIBLE_AIRPORTS);
        HTML_LABEL_AIRPORTS = VISIBLE_AIRPORTS;
        globe.htmlElementsData(HTML_LABEL_AIRPORTS);
    }

    globe.pointOfView({ lat: route.startLat, lng: route.startLng, altitude: 0.5 }, 1000);
}

function handleAirportClick(airport) {
    if (!airport) return;

    if (airport === selectedAirport) {
        updateVisualization();
        return;
    }

    selectedAirport = airport;
    console.log('Clicked airport:', airport);

    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.value = getIataCode(airport);

    // Build outbound routes
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
        .filter(Boolean);

    console.log('Found routes:', activeRoutes.length);
    globe.arcsData(activeRoutes);

    // Reset route selection
    selectedRoute = null;
    const routeInfo = document.getElementById('route-info-panel');
    if (routeInfo) routeInfo.style.display = 'none';

    // Filter visible airports
    const connectedIatas = new Set([airport.iata, ...activeRoutes.map(r => r.dstIata)]);
    VISIBLE_AIRPORTS = AIRPORTS.filter(a => connectedIatas.has(a.iata));
    globe.pointsData(VISIBLE_AIRPORTS);
    HTML_LABEL_AIRPORTS = VISIBLE_AIRPORTS;
    globe.htmlElementsData(HTML_LABEL_AIRPORTS);

    globe.pointOfView({ lat: parseFloat(airport.lat), lng: parseFloat(airport.lng), altitude: 1.5 }, 1000);
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

        // Clean up route keys
        ROUTES = rawRoutes.map(r => {
            const newR = {};
            Object.keys(r).forEach(k => newR[k.trim()] = r[k]);
            return newR;
        });

        console.log(`Loaded ${AIRPORTS.length} airports and ${ROUTES.length} routes.`);

        VISIBLE_AIRPORTS = AIRPORTS;
        globe.pointsData(VISIBLE_AIRPORTS);
        HTML_LABEL_AIRPORTS = getTopAirportsByFlights(AIRPORTS, CONFIG.WORLD_LABEL_LIMIT);
        globe.htmlElementsData(HTML_LABEL_AIRPORTS);

        const loadingEl = document.getElementById('loading');
        if (loadingEl) loadingEl.style.display = 'none';

        globe.pointOfView({ lat: 35, lng: -90, altitude: 1 }, 0);

        // Populate Categories
        const categories = new Set(AIRPORTS.map(a => getSizeCategory(a)));
        const select = document.getElementById('category-filter');
        if (select) {
            const sortedCategories = [...categories].sort((a, b) => {
                const idxA = CONFIG.CATEGORY_ORDER.indexOf(a);
                const idxB = CONFIG.CATEGORY_ORDER.indexOf(b);
                // If not found in order list, put at the end
                return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
            });

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
                alert('Error: Cannot load data when opening via file://. Please run a local server.');
            }
        }
    }
}

// =======================
// Initialization
// =======================

document.getElementById('category-filter')?.addEventListener('change', updateVisualization);

document.getElementById('search-input')?.addEventListener('input', (e) => {
    updateVisualization();
    createSuggestions(e.target.value.toLowerCase().trim(), 'airport');
});

document.getElementById('route-search-input')?.addEventListener('input', (e) => {
    createSuggestions(e.target.value.toLowerCase().trim(), 'route');
});

document.getElementById('reset-btn')?.addEventListener('click', resetView);

// Close suggestions on click outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('#search-wrapper')) {
        const el = document.getElementById('search-suggestions');
        if (el) el.style.display = 'none';
    }
    if (!e.target.closest('#route-search-wrapper')) {
        const el = document.getElementById('route-search-suggestions');
        if (el) el.style.display = 'none';
    }
});

loadData();
