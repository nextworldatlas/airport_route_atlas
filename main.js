import { csvParse } from 'https://esm.sh/d3-dsv';

// =======================
// Configuration
// =======================
const CONFIG = {
    AIRPORT_COLOR: '#8ddcff',
    AIRPORT_SELECTED_COLOR: '#991933',
    ROUTE_COLOR: '#ffffff',
    ROUTE_HIGHLIGHT_COLOR: '#ffd700',
    MAX_LABELS: 50,
    SATELLITE_TILES: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    CATEGORY_ORDER: ['Large', 'Medium', 'Small']
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
let currentBaseStroke = 0.25;

// =======================
// Helpers
// =======================

function getFlights(a) {
    const candidates = ['flights', 'Flights'];
    for (const key of candidates) {
        if (a[key] !== undefined && a[key] !== null && !isNaN(+a[key])) {
            return +a[key];
        }
    }
    return 0;
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
    const flights = getFlights(a);
    if (flights === 0) return 0.2;

    // Logarithmic scaling: maps flight count to radius range [0.2, 0.7]
    const minFlights = 10;
    const maxFlights = 1200;
    const minRadius = 0.2;
    const maxRadius = 0.7;

    const clampedFlights = Math.max(minFlights, Math.min(maxFlights, flights));
    const logMin = Math.log(minFlights);
    const logMax = Math.log(maxFlights);
    const logFlights = Math.log(clampedFlights);

    const t = (logFlights - logMin) / (logMax - logMin);
    return minRadius + t * (maxRadius - minRadius);
}

function isMobile() {
    return window.innerWidth <= 768;
}

function getDistance(lat1, lng1, lat2, lng2) {
    // Haversine formula for calculating distance between two points
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function getVisibleAirportsInViewport(airports) {
    // Get current point of view from globe
    const pov = globe.pointOfView();
    if (!pov) return airports;

    // Approximate viewport bounds based on altitude
    // Higher altitude = wider view
    const altitude = pov.altitude || 2;
    const viewportRadius = altitude * 60; // Rough approximation in degrees

    return airports.filter(a => {
        const lat = parseFloat(a.lat);
        const lng = parseFloat(a.lng);
        if (isNaN(lat) || isNaN(lng)) return false;

        // Simple bounding box check
        const latDiff = Math.abs(lat - pov.lat);
        const lngDiff = Math.abs(lng - pov.lng);

        // Handle longitude wraparound
        const lngDist = Math.min(lngDiff, 360 - lngDiff);

        return latDiff <= viewportRadius && lngDist <= viewportRadius;
    });
}


function getSpacedAirports(airports, minDistanceKm) {
    // Spatial decluttering: filter airports by minimum distance, prioritizing by flight count
    const sorted = [...airports].sort((a, b) => getFlights(b) - getFlights(a));

    const accepted = [];
    for (const airport of sorted) {
        let tooClose = false;
        for (const existing of accepted) {
            if (getDistance(airport.lat, airport.lng, existing.lat, existing.lng) < minDistanceKm) {
                tooClose = true;
                break;
            }
        }
        if (!tooClose) {
            accepted.push(airport);
        }
    }
    return accepted;
}

function getNetworkAltitudeFromMaxStage(maxStageMiles) {
    // Calculate zoom altitude based on route distances
    const MIN_STAGE = 200;  // Short routes
    const MAX_STAGE = 6000; // Ultra-long haul
    const minAlt = 0.6;     // Closest zoom
    const maxAlt = 1.1;     // Farthest zoomR

    const s = Math.max(MIN_STAGE, Math.min(MAX_STAGE, maxStageMiles || MIN_STAGE));
    const t = (s - MIN_STAGE) / (MAX_STAGE - MIN_STAGE);

    return minAlt + t * (maxAlt - minAlt);
}

function getRouteAltitude(route) {
    const dist = parseFloat(route.stage);
    if (isNaN(dist)) return 0.1;

    // Linear scaling for shorter routes (up to 4000 miles)
    if (dist <= 4000) {
        return dist / 12000; // 4000 miles -> 0.33 altitude
    }

    // Dampened growth for long-haul routes to prevent excessive arc height
    return 0.33 + (dist - 4000) / 40000;
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
        // Small airports (small radius) get very low altitude
        // Use exponential growth: smaller airports stay flatter
        const altitude = Math.pow(base / 0.7, 2) * 0.04;
        return d === selectedAirport ? altitude * 1.5 : altitude;
    })
    .pointLabel(d => `<b>${d.name} (${getIataCode(d)})</b><br>${d.country}`)
    .onPointClick(handleAirportClick)

    // Arcs (Routes)
    .arcColor(() => CONFIG.ROUTE_COLOR)
    .arcAltitude(getRouteAltitude) // Custom altitude logic
    .arcDashLength(1)
    .arcDashGap(0)
    .arcDashAnimateTime(0)
    .arcStroke(0.25)
    .arcsData([])
    .onArcHover(handleRouteHover)
    .onArcClick(handleRouteClick)
    .onGlobeClick(handleGlobeClick)

    // HTML Labels
    .htmlElementsData([])
    .htmlLat(d => +d.lat)
    .htmlLng(d => +d.lng)
    .htmlAltitude(d => {
        const base = getBaseRadius(d);
        // Match the airport base altitude exactly
        const altitude = Math.pow(base / 0.7, 2) * 0.04;
        return d === selectedAirport ? altitude * 1.5 : altitude;
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

function updateRouteInfoPanel(route) {
    const panel = document.getElementById('route-info-panel');
    if (!panel) return;

    if (!route) {
        panel.style.display = 'none';
        return;
    }

    // Find source and dest airport objects
    const src = AIRPORTS.find(a => a.iata === route.srcIata);
    const dst = AIRPORTS.find(a => a.iata === route.dstIata);

    // Populate Source
    const srcEl = document.getElementById('route-src');
    if (srcEl) {
        srcEl.querySelector('.route-iata').textContent = route.srcIata;
        const city = src ? (src.name || '').split(',')[0] : '';
        const country = src ? src.country : '';
        srcEl.querySelector('.route-desc').textContent = `${city}, ${country}`;
    }

    // Populate Dest
    const dstEl = document.getElementById('route-dst');
    if (dstEl) {
        dstEl.querySelector('.route-iata').textContent = route.dstIata;
        const city = dst ? (dst.name || '').split(',')[0] : '';
        const country = dst ? dst.country : '';
        dstEl.querySelector('.route-desc').textContent = `${city}, ${country}`;
    }

    document.getElementById('route-flights').textContent =
        route.flights ? `${route.flights} avg` : '-';
    document.getElementById('route-stage').textContent =
        route.stage ? `${route.stage} mi` : '-';
    document.getElementById('route-duration').textContent =
        route.duration ? `${route.duration} hr` : '-';

    panel.style.display = 'block';
}

function handleRouteHover(hoverRoute) {
    // If a route is selected/locked, don't override the panel
    if (selectedRoute) return;

    if (hoverRoute) {
        // highlight hovered route
        globe.arcColor(d =>
            d === hoverRoute ? CONFIG.ROUTE_HIGHLIGHT_COLOR : CONFIG.ROUTE_COLOR
        );
        globe.arcStroke(d => (d === hoverRoute ? 0.5 : currentBaseStroke));

        // show hover info in the existing panel
        updateRouteInfoPanel(hoverRoute);
    } else {
        // hover out: clear highlights & panel (if nothing selected)
        globe.arcColor(() => CONFIG.ROUTE_COLOR);
        globe.arcStroke(() => currentBaseStroke);

        updateRouteInfoPanel(null);
    }
}

function handleGlobeClick() {
    // 1. If a route is selected, deselect it but keep the hub view
    if (selectedRoute) {
        selectedRoute = null;
        updateRouteInfoPanel(null);

        // Revert to the hub view (all routes from selectedAirport)
        if (selectedAirport) {
            const activeRoutes = ROUTES
                .filter(r => r.srcIata === selectedAirport.iata)
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

            globe.arcsData(activeRoutes);

            // Restore stroke based on count
            currentBaseStroke = activeRoutes.length > 50 ? 0.1 : 0.25;
            globe.arcStroke(currentBaseStroke);

            const connectedIatas = new Set([
                selectedAirport.iata,
                ...activeRoutes.map(r => r.dstIata)
            ]);
            VISIBLE_AIRPORTS = AIRPORTS.filter(a => connectedIatas.has(a.iata));
            globe.pointsData(VISIBLE_AIRPORTS);

            // Re-apply route view spacing
            const maxStage = activeRoutes.reduce((max, r) => {
                const v = parseFloat(r.stage);
                return !isNaN(v) ? Math.max(max, v) : max;
            }, 0);
            const networkAltitude = getNetworkAltitudeFromMaxStage(maxStage);
            const baseSpacing = isMobile() ? 500 : 150;
            const dynamicSpacing = baseSpacing * (networkAltitude / 1.5);

            const otherAirports = VISIBLE_AIRPORTS.filter(a => a !== selectedAirport);
            const spacedOthers = getSpacedAirports(otherAirports, dynamicSpacing);
            HTML_LABEL_AIRPORTS = [selectedAirport, ...spacedOthers];
            globe.htmlElementsData(HTML_LABEL_AIRPORTS);

            globe.arcColor(() => CONFIG.ROUTE_COLOR);
        } else {
            // Route was selected via route search (no airport hub)
            // Clear the route search box and return to world view
            const routeSearchInput = document.getElementById('route-search-input');
            if (routeSearchInput) routeSearchInput.value = '';
            resetView();
        }
        return;
    }

    // 2. If no route is selected but a hub IS selected, go back to world view
    if (selectedAirport) {
        resetView();
    }
}

function updateVisualization() {
    selectedAirport = null;
    globe.arcsData([]);

    // Reset stroke for global view (no routes usually, but good practice)
    currentBaseStroke = 0.25;
    globe.arcStroke(currentBaseStroke);

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

    // Viewport-based label filtering
    const visibleInView = getVisibleAirportsInViewport(VISIBLE_AIRPORTS);

    // Sort by flight count (busiest first)
    const sortedByImportance = [...visibleInView].sort((a, b) => getFlights(b) - getFlights(a));

    // Apply spatial decluttering
    const spacing = isMobile() ? 500 : 150;
    const spacedAirports = getSpacedAirports(sortedByImportance, spacing);

    // Limit to max labels
    HTML_LABEL_AIRPORTS = spacedAirports.slice(0, CONFIG.MAX_LABELS);

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

    // Lock highlight on the selected route
    globe.arcColor(d =>
        d === route ? CONFIG.ROUTE_HIGHLIGHT_COLOR : 'rgba(255, 255, 255, 0.1)'
    );
    globe.arcStroke(d => (d === route ? 0.8 : 0.1));

    // Lock panel to this route
    updateRouteInfoPanel(route);

    // Ensure only this route is shown in arcsData
    globe.arcsData([route]);

    const src = AIRPORTS.find(a => a.iata === route.srcIata);
    const dst = AIRPORTS.find(a => a.iata === route.dstIata);

    if (src && dst) {
        VISIBLE_AIRPORTS = [src, dst];
        globe.pointsData(VISIBLE_AIRPORTS);
        HTML_LABEL_AIRPORTS = VISIBLE_AIRPORTS;
        globe.htmlElementsData(HTML_LABEL_AIRPORTS);
    }

    const routeAltitude = getNetworkAltitudeFromMaxStage(parseFloat(route.stage));
    globe.pointOfView({ lat: route.startLat, lng: route.startLng, altitude: routeAltitude }, 1000);
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

    // Dynamic Route Thickness
    currentBaseStroke = activeRoutes.length > 50 ? 0.1 : 0.25;
    globe.arcStroke(currentBaseStroke);

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

    // NEW: compute max stage (distance) for this airport's network
    const maxStage = activeRoutes.reduce((max, r) => {
        const v = parseFloat(r.stage);
        return !isNaN(v) ? Math.max(max, v) : max;
    }, 0);

    const networkAltitude = getNetworkAltitudeFromMaxStage(maxStage);

    // Dynamic Spacing for Route View
    // Scale spacing based on altitude: lower altitude (zoomed in) = smaller spacing allowed
    const baseSpacing = isMobile() ? 500 : 150;
    const dynamicSpacing = baseSpacing * (networkAltitude / 1.5); // 1.5 is roughly the "global" altitude reference

    // Apply spacing, but ALWAYS include the selected airport
    // We filter the REST of the airports, then add selectedAirport back if missing
    const otherAirports = VISIBLE_AIRPORTS.filter(a => a !== selectedAirport);
    const spacedOthers = getSpacedAirports(otherAirports, dynamicSpacing);

    // Ensure selectedAirport is at the front
    HTML_LABEL_AIRPORTS = [selectedAirport, ...spacedOthers];
    globe.htmlElementsData(HTML_LABEL_AIRPORTS);

    globe.pointOfView({
        lat: parseFloat(airport.lat),
        lng: parseFloat(airport.lng),
        altitude: networkAltitude
    }, 1000);
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

        // Viewport-based label filtering for initial load
        const visibleInView = getVisibleAirportsInViewport(AIRPORTS);
        const sortedByImportance = [...visibleInView].sort((a, b) => getFlights(b) - getFlights(a));
        const spacing = isMobile() ? 500 : 150;
        const spacedAirports = getSpacedAirports(sortedByImportance, spacing);
        HTML_LABEL_AIRPORTS = spacedAirports.slice(0, CONFIG.MAX_LABELS);
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

// UI Toggle Logic
const uiToggleBtn = document.getElementById('ui-toggle-btn');
const uiLayer = document.getElementById('ui-layer');

function updateButtonIcon() {
    if (!uiToggleBtn || !uiLayer) return;

    const mobile = isMobile();
    const hasClass = uiLayer.classList.contains('nav-toggle');

    // Both desktop and mobile: visible by default, hidden when nav-toggle class present
    const isVisible = !hasClass;

    uiToggleBtn.setAttribute('aria-label', isVisible ? 'Hide UI' : 'Show UI');

    if (mobile) {
        // Mobile: Up arrow to hide (slide up), Down arrow to show (slide down)
        uiToggleBtn.textContent = isVisible ? '▲' : '▼';
    } else {
        // Desktop: Left arrow to hide (slide left), Right arrow to show (slide right)
        uiToggleBtn.textContent = isVisible ? '◀' : '▶';
    }
}

if (uiToggleBtn && uiLayer) {
    uiToggleBtn.addEventListener('click', () => {
        uiLayer.classList.toggle('nav-toggle');
        updateButtonIcon();
    });

    // Initial update
    updateButtonIcon();

    // Update on resize
    window.addEventListener('resize', updateButtonIcon);
}


// Update labels dynamically on zoom/pan
let labelUpdateTimeout = null;
globe.onZoom(() => {
    // Throttle updates to avoid excessive recalculation
    if (labelUpdateTimeout) clearTimeout(labelUpdateTimeout);
    labelUpdateTimeout = setTimeout(() => {
        if (!selectedAirport && !selectedRoute) {
            // Only update in world view, not when viewing airport routes or specific routes
            updateVisualization();
        }
    }, 300); // 300ms delay after user stops moving
});

loadData();

