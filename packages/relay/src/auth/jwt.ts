import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

const secret = new TextEncoder().encode(process.env.JWT_SECRET!);

export interface DaemonTokenPayload extends JWTPayload {
  accountId: string;
  daemonId:  string;
  scope:     'daemon';
}

export interface ClientTokenPayload extends JWTPayload {
  accountId: string;
  userId:    string;
  scope:     'client';
}

export type TokenPayload = DaemonTokenPayload | ClientTokenPayload;

export async function signDaemonJwt(
  accountId: string,
  daemonId:  string,
  jti:       string,
): Promise<string> {
  return new SignJWT({
    accountId,
    daemonId,
    scope: 'daemon',
  } satisfies Omit<DaemonTokenPayload, keyof JWTPayload>)
    .setProtectedHeader({ alg: 'HS256' })
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime('30d')
    .setAudience('pocket-t-relay')
    .sign(secret);
}

export async function signClientJwt(
  accountId: string,
  userId:    string,
): Promise<string> {
  return new SignJWT({
    accountId,
    userId,
    scope: 'client',
  } satisfies Omit<ClientTokenPayload, keyof JWTPayload>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .setAudience('pocket-t-relay')
    .sign(secret);
}

export async function verifyJwt(token: string): Promise<TokenPayload> {
  const { payload } = await jwtVerify(token, secret, {
    audience: 'pocket-t-relay',
  });
  return payload as TokenPayload;
}
