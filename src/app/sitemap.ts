import { MetadataRoute } from 'next';

const NFL_TEAMS = [
  'ari', 'atl', 'bal', 'buf', 'car', 'chi', 'cin', 'cle',
  'dal', 'den', 'det', 'gb', 'hou', 'ind', 'jax', 'kc',
  'lac', 'lar', 'lv', 'mia', 'min', 'ne', 'no', 'nyg',
  'nyj', 'phi', 'pit', 'sea', 'sf', 'tb', 'ten', 'was',
];

const NBA_TEAMS = [
  'atl', 'bos', 'bkn', 'cha', 'chi', 'cle', 'dal', 'den',
  'det', 'gsw', 'hou', 'ind', 'lac', 'lal', 'mem', 'mia',
  'mil', 'min', 'nop', 'nyk', 'okc', 'orl', 'phi', 'phx',
  'por', 'sac', 'sas', 'tor', 'uta', 'was',
];

const NHL_TEAMS = [
  'ana', 'ari', 'bos', 'buf', 'cgy', 'car', 'chi', 'col',
  'cbj', 'dal', 'det', 'edm', 'fla', 'la', 'min', 'mtl',
  'nsh', 'nj', 'nyi', 'nyr', 'ott', 'phi', 'pit', 'sj',
  'sea', 'stl', 'tb', 'tor', 'van', 'vgk', 'wsh', 'wpg',
];

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = 'https://www.predictionmatrix.com';

  const staticPages: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      url: `${baseUrl}/dashboard`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/rankings`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/results`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.8,
    },
    {
      url: `${baseUrl}/nba`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/nba/rankings`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/nba/results`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.8,
    },
    {
      url: `${baseUrl}/nba/live`,
      lastModified: new Date(),
      changeFrequency: 'always',
      priority: 0.8,
    },
    {
      url: `${baseUrl}/nhl`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/nhl/rankings`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/nhl/results`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.8,
    },
    {
      url: `${baseUrl}/nhl/live`,
      lastModified: new Date(),
      changeFrequency: 'always',
      priority: 0.8,
    },
    {
      url: `${baseUrl}/about`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    {
      url: `${baseUrl}/faq`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    // CBB (College Basketball) pages
    {
      url: `${baseUrl}/cbb`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/cbb/rankings`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/cbb/results`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.8,
    },
  ];

  const nflTeamPages: MetadataRoute.Sitemap = NFL_TEAMS.map((abbr) => ({
    url: `${baseUrl}/nfl/teams/${abbr}`,
    lastModified: new Date(),
    changeFrequency: 'daily' as const,
    priority: 0.8,
  }));

  const nbaTeamPages: MetadataRoute.Sitemap = NBA_TEAMS.map((abbr) => ({
    url: `${baseUrl}/nba/teams/${abbr}`,
    lastModified: new Date(),
    changeFrequency: 'daily' as const,
    priority: 0.8,
  }));

  const nhlTeamPages: MetadataRoute.Sitemap = NHL_TEAMS.map((abbr) => ({
    url: `${baseUrl}/nhl/teams/${abbr}`,
    lastModified: new Date(),
    changeFrequency: 'daily' as const,
    priority: 0.8,
  }));

  return [...staticPages, ...nflTeamPages, ...nbaTeamPages, ...nhlTeamPages];
}
