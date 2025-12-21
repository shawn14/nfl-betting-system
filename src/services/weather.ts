import { WeatherData } from '@/types';

const OPENWEATHER_BASE = 'https://api.openweathermap.org/data/2.5';

// NFL stadium coordinates (outdoor stadiums only)
const NFL_STADIUMS: Record<string, { lat: number; lon: number; indoor: boolean }> = {
  'Arrowhead Stadium': { lat: 39.0489, lon: -94.4839, indoor: false },
  'Highmark Stadium': { lat: 42.7738, lon: -78.7870, indoor: false },
  'Empower Field at Mile High': { lat: 39.7439, lon: -105.0201, indoor: false },
  'FirstEnergy Stadium': { lat: 41.5061, lon: -81.6995, indoor: false },
  'Huntington Bank Field': { lat: 41.5061, lon: -81.6995, indoor: false }, // Cleveland (renamed)
  'Gillette Stadium': { lat: 42.0909, lon: -71.2643, indoor: false },
  'Hard Rock Stadium': { lat: 25.9580, lon: -80.2389, indoor: false },
  'Lumen Field': { lat: 47.5952, lon: -122.3316, indoor: false },
  'M&T Bank Stadium': { lat: 39.2780, lon: -76.6227, indoor: false },
  'MetLife Stadium': { lat: 40.8128, lon: -74.0742, indoor: false },
  'Nissan Stadium': { lat: 36.1665, lon: -86.7713, indoor: false },
  'Paycor Stadium': { lat: 39.0955, lon: -84.5160, indoor: false },
  'Raymond James Stadium': { lat: 27.9759, lon: -82.5033, indoor: false },
  'Soldier Field': { lat: 41.8623, lon: -87.6167, indoor: false },
  'TIAA Bank Field': { lat: 30.3239, lon: -81.6373, indoor: false },
  'Levi\'s Stadium': { lat: 37.4033, lon: -121.9694, indoor: false },
  'Lambeau Field': { lat: 44.5013, lon: -88.0622, indoor: false },
  'Lincoln Financial Field': { lat: 39.9008, lon: -75.1675, indoor: false },
  'Acrisure Stadium': { lat: 40.4468, lon: -80.0158, indoor: false },
  'FedExField': { lat: 38.9076, lon: -76.8645, indoor: false },
  'Bank of America Stadium': { lat: 35.2258, lon: -80.8528, indoor: false },
  // Domed/Indoor stadiums
  'SoFi Stadium': { lat: 33.9535, lon: -118.3392, indoor: true },
  'AT&T Stadium': { lat: 32.7473, lon: -97.0945, indoor: true },
  'Caesars Superdome': { lat: 29.9511, lon: -90.0812, indoor: true },
  'Ford Field': { lat: 42.3400, lon: -83.0456, indoor: true },
  'Lucas Oil Stadium': { lat: 39.7601, lon: -86.1639, indoor: true },
  'Mercedes-Benz Stadium': { lat: 33.7554, lon: -84.4010, indoor: true },
  'State Farm Stadium': { lat: 33.5276, lon: -112.2626, indoor: true },
  'U.S. Bank Stadium': { lat: 44.9736, lon: -93.2575, indoor: true },
  'Allegiant Stadium': { lat: 36.0909, lon: -115.1833, indoor: true },
  'NRG Stadium': { lat: 29.6847, lon: -95.4107, indoor: true },
};

export async function fetchWeatherForVenue(venueName: string, gameTime: Date): Promise<WeatherData | null> {
  const apiKey = process.env.NEXT_PUBLIC_WEATHER_API_KEY;
  if (!apiKey || apiKey === 'your_openweather_key') {
    console.warn('Weather API key not configured');
    return null;
  }

  const stadium = NFL_STADIUMS[venueName];
  if (!stadium) {
    console.warn(`Stadium not found: ${venueName}`);
    return null;
  }

  // Indoor stadiums don't have weather impact
  if (stadium.indoor) {
    return {
      temperature: 72,
      windSpeed: 0,
      windDirection: 'N/A',
      precipitation: 0,
      humidity: 50,
      conditions: 'Indoor',
    };
  }

  const now = new Date();
  const hoursDiff = (gameTime.getTime() - now.getTime()) / (1000 * 60 * 60);

  let url: string;
  if (hoursDiff < 0 || hoursDiff > 120) {
    // Game is in the past or too far in future, get current weather as approximation
    url = `${OPENWEATHER_BASE}/weather?lat=${stadium.lat}&lon=${stadium.lon}&appid=${apiKey}&units=imperial`;
  } else {
    // Use forecast for upcoming games
    url = `${OPENWEATHER_BASE}/forecast?lat=${stadium.lat}&lon=${stadium.lon}&appid=${apiKey}&units=imperial`;
  }

  const response = await fetch(url);
  if (!response.ok) {
    console.error('Weather API error:', response.statusText);
    return null;
  }

  const data = await response.json();

  if (data.list) {
    // Forecast data - find closest time
    const targetTime = gameTime.getTime();
    let closest = data.list[0];
    let closestDiff = Math.abs(new Date(closest.dt * 1000).getTime() - targetTime);

    for (const forecast of data.list) {
      const diff = Math.abs(new Date(forecast.dt * 1000).getTime() - targetTime);
      if (diff < closestDiff) {
        closest = forecast;
        closestDiff = diff;
      }
    }

    return {
      temperature: Math.round(closest.main.temp),
      windSpeed: Math.round(closest.wind.speed),
      windDirection: degreesToDirection(closest.wind.deg),
      precipitation: closest.pop ? Math.round(closest.pop * 100) : 0,
      humidity: closest.main.humidity,
      conditions: closest.weather[0]?.description || 'Unknown',
    };
  } else {
    // Current weather data
    return {
      temperature: Math.round(data.main.temp),
      windSpeed: Math.round(data.wind.speed),
      windDirection: degreesToDirection(data.wind.deg),
      precipitation: data.rain?.['1h'] ? 100 : 0,
      humidity: data.main.humidity,
      conditions: data.weather[0]?.description || 'Unknown',
    };
  }
}

function degreesToDirection(degrees: number): string {
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.round(degrees / 22.5) % 16;
  return directions[index];
}

export function getWeatherImpact(weather: WeatherData | null): number {
  if (!weather || weather.conditions === 'Indoor') return 0;

  let impact = 0;

  // Wind impact (affects passing game)
  if (weather.windSpeed > 15) impact += 0.5;
  if (weather.windSpeed > 25) impact += 1.0;

  // Temperature impact (extreme cold/heat)
  if (weather.temperature < 20) impact += 0.5;
  if (weather.temperature < 10) impact += 0.5;
  if (weather.temperature > 95) impact += 0.3;

  // Precipitation impact
  if (weather.precipitation > 30) impact += 0.5;
  if (weather.precipitation > 60) impact += 0.5;

  return impact;
}
