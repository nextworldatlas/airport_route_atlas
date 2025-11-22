// --- DATA ---
const AIRPORTS = [
    { id: 'JFK', name: 'New York (JFK)', lat: 40.6413, lng: -73.7781, country: 'USA', category: 'Large' },
    { id: 'LHR', name: 'London (LHR)', lat: 51.4700, lng: -0.4543, country: 'UK', category: 'Large' },
    { id: 'HND', name: 'Tokyo (HND)', lat: 35.5494, lng: 139.7798, country: 'Japan', category: 'Large' },
    { id: 'DXB', name: 'Dubai (DXB)', lat: 25.2532, lng: 55.3644, country: 'UAE', category: 'Large' },
    { id: 'SYD', name: 'Sydney (SYD)', lat: -33.9461, lng: 151.1772, country: 'Australia', category: 'Medium' },
    { id: 'LAX', name: 'Los Angeles (LAX)', lat: 33.9416, lng: -118.4085, country: 'USA', category: 'Medium' },
    { id: 'CDG', name: 'Paris (CDG)', lat: 49.0097, lng: 2.5479, country: 'France', category: 'Medium' },
    { id: 'SIN', name: 'Singapore (SIN)', lat: 1.3644, lng: 103.9915, country: 'Singapore', category: 'Medium' },
    { id: 'GRU', name: 'Sao Paulo (GRU)', lat: -23.4356, lng: -46.4730, country: 'Brazil', category: 'Small' },
    { id: 'JNB', name: 'Johannesburg (JNB)', lat: -26.1367, lng: 28.2460, country: 'South Africa', category: 'Small' }
];

const ROUTES = [
    { src: 'JFK', dst: 'LHR' }, { src: 'JFK', dst: 'HND' }, { src: 'JFK', dst: 'DXB' }, { src: 'JFK', dst: 'LAX' },
    { src: 'LHR', dst: 'JFK' }, { src: 'LHR', dst: 'SIN' }, { src: 'LHR', dst: 'JNB' },
    { src: 'HND', dst: 'LAX' }, { src: 'HND', dst: 'SYD' }, { src: 'HND', dst: 'SIN' },
    { src: 'DXB', dst: 'LHR' }, { src: 'DXB', dst: 'JFK' }, { src: 'DXB', dst: 'SYD' },
    { src: 'SYD', dst: 'LAX' }, { src: 'SYD', dst: 'HND' },
    { src: 'LAX', dst: 'JFK' }, { src: 'LAX', dst: 'HND' }, { src: 'LAX', dst: 'SYD' },
    { src: 'SIN', dst: 'LHR' }, { src: 'SIN', dst: 'HND' },
    { src: 'GRU', dst: 'JFK' }, { src: 'GRU', dst: 'CDG' }
];

// --- INITIALIZATION ---
const world = Globe()
    (document.getElementById('globeViz'))
    .globeImageUrl('//unpkg.com/three-globe/example/img/earth-night.jpg')
    .backgroundImageUrl('//unpkg.com/three-globe/example/img/night-sky.png')
    .pointsData(AIRPORTS)
    .pointAltitude(0.02)
    .pointColor(() => '#ffb703')
    .pointRadius(0.5)
    .pointLabel('name')
    .onPointClick(handlePointClick)
    .arcsColor(() => '#4cc9f0')
    .arcDashLength(0.4)
    .arcDashGap(0.2)
    .arcDashAnimateTime(1500)
    .arcStroke(0.5);

// Auto-rotate
world.controls().autoRotate = true;
world.controls().autoRotateSpeed = 0.5;

// --- INTERACTION ---

function handlePointClick(airport) {
    // Find routes starting from this airport
    const relevantRoutes = ROUTES.filter(r => r.src === airport.id);
    
    // Map routes to objects with lat/lng
    const arcsData = relevantRoutes.map(route => {
        const src = AIRPORTS.find(a => a.id === route.src);
        const dst = AIRPORTS.find(a => a.id === route.dst);
        return {
            startLat: src.lat,
            startLng: src.lng,
            endLat: dst.lat,
            endLng: dst.lng
        };
    });

    world.arcsData(arcsData);
    
    // Focus on the clicked airport
    world.pointOfView({ lat: airport.lat, lng: airport.lng, altitude: 1.5 }, 1000);
}

// --- CONTROLS ---

// 1. Rotation Toggle
const rotateToggle = document.getElementById('rotateToggle');
rotateToggle.addEventListener('change', (e) => {
    world.controls().autoRotate = e.target.checked;
});

// 2. Category Filter
const categorySelect = document.getElementById('categorySelect');
categorySelect.addEventListener('change', (e) => {
    const category = e.target.value;
    let filteredAirports = AIRPORTS;

    if (category !== 'All') {
        filteredAirports = AIRPORTS.filter(a => a.category === category);
    }

    world.pointsData(filteredAirports);

    // Clear routes when filtering to avoid confusion
    world.arcsData([]);
});

// Stop rotation on user interaction (and update toggle)
const container = document.getElementById('globeViz');
const stopRotation = () => {
    world.controls().autoRotate = false;
    rotateToggle.checked = false;
};

container.addEventListener('mousedown', stopRotation);
container.addEventListener('touchstart', stopRotation);

// Responsive resize
window.addEventListener('resize', () => {
    world.width(window.innerWidth);
    world.height(window.innerHeight);
});
