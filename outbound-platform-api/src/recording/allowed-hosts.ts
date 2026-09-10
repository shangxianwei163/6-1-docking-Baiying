export function parseRecordingSourceAllowedHosts(value: string): string[] {
  const hosts = value
    .split(',')
    .map((host) => host.trim().toLowerCase().replace(/\.$/, ''))
    .filter(Boolean);
  return [...new Set(hosts)];
}
