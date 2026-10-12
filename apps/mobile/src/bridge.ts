const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const secretPattern = /^[A-Za-z0-9_-]{43}$/;

export type PairingCode = { pairingId: string; secret: string };
export type LinkedDevice = {
  desktopDeviceId: string;
  mobileDeviceId: string;
  desktopName: string;
  mobileName: string;
};
export type RemoteTask = {
  id: string;
  sessionId: string;
  desktopDeviceId: string;
  prompt: string;
  status: 'queued' | 'claimed' | 'succeeded' | 'failed' | 'cancelled';
  result: string | null;
  createdAt: string;
  updatedAt: string;
};

export function selectPreferredDesktop(
  devices: Pick<LinkedDevice, 'desktopDeviceId'>[], current: string,
  stored: string, preferLatest: boolean,
): string {
  if (preferLatest) return devices[0]?.desktopDeviceId ?? '';
  if (devices.some(device => device.desktopDeviceId === current)) return current;
  if (devices.some(device => device.desktopDeviceId === stored)) return stored;
  return devices[0]?.desktopDeviceId ?? '';
}

export function parsePairingCode(raw: string): PairingCode {
  const value = raw.trim();
  let params: URLSearchParams;
  if (value.startsWith('harmonywork://')) {
    const match = /^harmonywork:\/\/pair\/?\?([^#]*)$/.exec(value);
    if (!match) throw new Error('这不是 Harmony Work 的配对二维码');
    params = new URLSearchParams(match[1]);
  } else if (/^(?:id|pairingId)=/.test(value)) {
    params = new URLSearchParams(value.replace(/\r?\n/g, '&'));
  } else {
    throw new Error('请粘贴桌面端「复制配对内容」中的完整文本');
  }
  const pairingId = params.get('id') ?? params.get('pairingId') ?? '';
  const secret = params.get('secret') ?? '';
  if (!uuidPattern.test(pairingId) || !secretPattern.test(secret)) {
    throw new Error('配对二维码内容无效');
  }
  return { pairingId, secret };
}
