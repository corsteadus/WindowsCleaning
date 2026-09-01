import * as oidc from "openid-client";
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { eq, inArray, or, sql } from "drizzle-orm";
import { db, crewMembersTable, crewsTable, jobsTable, usersTable } from "@workspace/db";
import {
  clearSession,
  getOidcConfig,
  getSessionId,
  getSession,
  createSession,
  deleteSession,
  SESSION_COOKIE,
  SESSION_TTL,
  ISSUER_URL,
  type SessionData,
  type StoredSessionUser,
} from "../lib/auth";
import { getSafeReturnTo } from "../lib/safe-return-to";
import { verifyPassword, burnPasswordCheck } from "../lib/password";
import {
  authenticateLocalUser,
  normalizeUsername,
  LoginThrottle,
} from "../lib/local-login";
import {
  isAssignmentScopedOperationalRole,
  isKnownAuthorizationRole,
} from "../lib/authorization";
import { normalizeAuthorizationRole } from "../lib/role-normalization";
import { deriveAuthorizationVersions } from "../lib/authorization-versions";

const GetCurrentAuthUserResponse = z.object({
  user: z.union([
    z.object({
      id: z.string(),
      email: z.string().nullable(),
      firstName: z.string().nullable(),
      lastName: z.string().nullable(),
      profileImageUrl: z.string().nullable(),
      role: z.string().default("admin"),
      userId: z.string(),
      tenantId: z.string(),
      normalizedRole: z.string(),
      capabilities: z.array(z.string()),
      permissionVersion: z.string(),
      assignmentScopeVersion: z.string(),
    }),
    z.null(),
  ]),
});

const ExchangeMobileAuthorizationCodeBody = z.object({
  code: z.string().min(1),
  code_verifier: z.string().min(1),
  redirect_uri: z.string().min(1),
  state: z.string().min(1),
  nonce: z.string().min(1).optional(),
});

const ExchangeMobileAuthorizationCodeResponse = z.object({
  token: z.string(),
});

const LogoutMobileSessionResponse = z.object({
  success: z.literal(true),
});

const OIDC_COOKIE_TTL = 10 * 60 * 1000;

const router: IRouter = Router();
const TENANT_ID = "single-tenant";

async function withAuthorizationMetadata(user: Express.User) {
  const normalizedRole = normalizeAuthorizationRole(user.role);
  const assignedGraph = isAssignmentScopedOperationalRole(normalizedRole)
    ? await (async () => {
      // Deliberately derive from the complete, non-commercial authorization
      // graph, not only currently visible jobs. Thus membership/lead, crew,
      // user activation, and future direct-assignment changes invalidate an
      // existing scope fingerprint even when no job row itself changes.
      const [identity, memberships] = await Promise.all([
        db.select({ id: usersTable.id, isActive: usersTable.isActive, updatedAt: usersTable.updatedAt })
          .from(usersTable).where(eq(usersTable.id, user.id)),
        db.select({
          crewId: crewMembersTable.crewId,
          role: crewMembersTable.role,
          membershipUpdatedAt: crewMembersTable.updatedAt,
          crewIsActive: crewsTable.isActive,
          crewUpdatedAt: crewsTable.updatedAt,
        }).from(crewMembersTable)
          .innerJoin(crewsTable, eq(crewMembersTable.crewId, crewsTable.id))
          .where(eq(crewMembersTable.userId, user.id)),
      ]);
      const crewIds = memberships.map((membership) => membership.crewId);
      const jobs = await db.select({
        id: jobsTable.id,
        crewId: jobsTable.crewId,
        assignedTechnicianUserId: jobsTable.assignedTechnicianUserId,
        updatedAt: jobsTable.updatedAt,
      }).from(jobsTable).where(or(
        eq(jobsTable.assignedTechnicianUserId, user.id),
        crewIds.length ? inArray(jobsTable.crewId, crewIds) : sql`false`,
      )).orderBy(jobsTable.id);
      return [
        ...identity.map((row) => ({ kind: "user", id: row.id, isActive: row.isActive, updatedAt: row.updatedAt.toISOString() })),
        ...memberships.map((row) => ({
          kind: "membership", crewId: row.crewId, role: row.role,
          membershipUpdatedAt: row.membershipUpdatedAt.toISOString(),
          crewIsActive: row.crewIsActive, crewUpdatedAt: row.crewUpdatedAt.toISOString(),
        })),
        ...jobs.map((row) => ({
          kind: "job", id: row.id, crewId: row.crewId,
          assignedTechnicianUserId: row.assignedTechnicianUserId,
          updatedAt: row.updatedAt.toISOString(),
        })),
      ];
    })()
    : [];
  const versions = deriveAuthorizationVersions(
    user.id,
    normalizedRole,
    assignedGraph,
  );
  return {
    ...user,
    userId: user.id,
    tenantId: TENANT_ID,
    role: normalizedRole,
    ...versions,
  };
}

function getOrigin(req: Request): string {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host =
    req.headers["x-forwarded-host"] || req.headers["host"] || "localhost";
  return `${proto}://${host}`;
}

function setSessionCookie(res: Response, sid: string) {
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
}

function setOidcCookie(res: Response, name: string, value: string) {
  res.cookie(name, value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: OIDC_COOKIE_TTL,
  });
}

const SUPER_ADMIN_EMAIL = "lute.atieh@gmail.com";

// Emails that should always receive a specific role on sign-in.
// Add entries here to pre-assign roles to team members.
const EMAIL_ROLE_MAP: Record<string, string> = {
  "lute.atieh@gmail.com": "super_admin",
  "lute@flystj.com": "employee",
  // Kyle — owner of Superior Window Cleaning; also has a local username login.
  "kstaffinvest@gmail.com": "super_admin",
};

function roleForEmail(email: string | null): string {
  if (!email) return "admin";
  return EMAIL_ROLE_MAP[email.toLowerCase()] ?? "admin";
}

async function upsertUser(claims: Record<string, unknown>) {
  const sub   = claims.sub as string;
  const email = (claims.email as string) || null;
  const firstName        = (claims.first_name as string) || null;
  const lastName         = (claims.last_name as string) || null;
  const profileImageUrl  = (claims.profile_image_url || claims.picture) as string | null;
  const assignedRole     = roleForEmail(email);
  const profileUpdate    = {
    email,
    firstName,
    lastName,
    profileImageUrl,
    updatedAt: new Date(),
  };

  // Step 1: look up by sub (the stable Replit user identifier)
  const byId = await db.select().from(usersTable).where(eq(usersTable.id, sub)).limit(1);
  if (byId.length > 0) {
    const [updated] = await db
      .update(usersTable)
      .set(profileUpdate)
      .where(eq(usersTable.id, sub))
      .returning();
    return updated;
  }

  // Step 2: look up by email (handles changed subs or duplicate email scenario)
  if (email) {
    const byEmail = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (byEmail.length > 0) {
      const [updated] = await db
        .update(usersTable)
        .set(profileUpdate)
        .where(eq(usersTable.email, email))
        .returning();
      return updated;
    }
  }

  // Step 3: brand-new user — insert
  const [inserted] = await db
    .insert(usersTable)
    .values({
      id: sub,
      email,
      firstName,
      lastName,
      profileImageUrl,
      role: assignedRole,
    })
    .returning();
  return inserted;
}

router.get("/auth/user", async (req: Request, res: Response) => {
  const user = req.isAuthenticated()
    ? await withAuthorizationMetadata(req.user)
    : null;
  res.json(
    GetCurrentAuthUserResponse.parse({
      user,
    }),
  );
});

// ─── Local username/password login ─────────────────────────────────────────
const LoginWithPasswordBody = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
});

const loginThrottle = new LoginThrottle();

async function findUserByUsername(normalizedUsername: string) {
  const rows = await db
    .select()
    .from(usersTable)
    .where(sql`lower(${usersTable.username}) = ${normalizedUsername}`)
    .limit(1);
  return rows[0] ?? null;
}

router.post("/auth/login", async (req: Request, res: Response) => {
  const parsed = LoginWithPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Username and password are required" });
    return;
  }

  const normalized = normalizeUsername(parsed.data.username);
  const throttleKey = `${req.ip ?? "unknown"}|${normalized}`;
  if (loginThrottle.isBlocked(throttleKey)) {
    res.status(429).json({
      error: "Too many login attempts. Please try again in a few minutes.",
    });
    return;
  }

  const result = await authenticateLocalUser(
    { findUserByUsername, verifyPassword, burnPasswordCheck },
    parsed.data.username,
    parsed.data.password,
  );

  if (!result.ok) {
    loginThrottle.recordFailure(throttleKey);
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }
  if (!isKnownAuthorizationRole(result.user.role)) {
    res.status(403).json({ error: "Access denied", code: "unknown_role" });
    return;
  }

  loginThrottle.reset(throttleKey);

  const sessionData: SessionData = {
    user: result.user,
    access_token: "",
    auth_method: "local",
  };
  const sid = await createSession(sessionData);
  setSessionCookie(res, sid);
  res.json(GetCurrentAuthUserResponse.parse({
    user: await withAuthorizationMetadata(result.user as StoredSessionUser),
  }));
});

router.get("/login", async (req: Request, res: Response) => {
  const config = await getOidcConfig();
  const callbackUrl = `${getOrigin(req)}/api/callback`;

  const returnTo = getSafeReturnTo(req.query.returnTo);

  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);

  const redirectTo = oidc.buildAuthorizationUrl(config, {
    redirect_uri: callbackUrl,
    scope: "openid email profile offline_access",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    prompt: "login consent",
    state,
    nonce,
  });

  setOidcCookie(res, "code_verifier", codeVerifier);
  setOidcCookie(res, "nonce", nonce);
  setOidcCookie(res, "state", state);
  setOidcCookie(res, "return_to", returnTo);

  res.redirect(redirectTo.href);
});

// Query params are not validated because the OIDC provider may include
// parameters not expressed in the schema.
router.get("/callback", async (req: Request, res: Response) => {
  const config = await getOidcConfig();
  const callbackUrl = `${getOrigin(req)}/api/callback`;

  const codeVerifier = req.cookies?.code_verifier;
  const nonce = req.cookies?.nonce;
  const expectedState = req.cookies?.state;

  if (!codeVerifier || !expectedState) {
    res.redirect("/api/login");
    return;
  }

  const currentUrl = new URL(
    `${callbackUrl}?${new URL(req.url, `http://${req.headers.host}`).searchParams}`,
  );

  let tokens: oidc.TokenEndpointResponse & oidc.TokenEndpointResponseHelpers;
  try {
    tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: codeVerifier,
      expectedNonce: nonce,
      expectedState,
      idTokenExpected: true,
    });
  } catch {
    res.redirect("/api/login");
    return;
  }

  const returnTo = getSafeReturnTo(req.cookies?.return_to);

  res.clearCookie("code_verifier", { path: "/" });
  res.clearCookie("nonce", { path: "/" });
  res.clearCookie("state", { path: "/" });
  res.clearCookie("return_to", { path: "/" });

  const claims = tokens.claims();
  if (!claims) {
    res.redirect("/api/login");
    return;
  }

  const dbUser = await upsertUser(
    claims as unknown as Record<string, unknown>,
  );
  if (!dbUser.isActive || !isKnownAuthorizationRole(dbUser.role)) {
    res.redirect("/api/login");
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const sessionData: SessionData = {
    user: {
      id: dbUser.id,
      email: dbUser.email,
      firstName: dbUser.firstName,
      lastName: dbUser.lastName,
      profileImageUrl: dbUser.profileImageUrl,
      role: dbUser.role,
    },
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: tokens.expiresIn() ? now + tokens.expiresIn()! : claims.exp,
  };

  const sid = await createSession(sessionData);
  setSessionCookie(res, sid);
  res.redirect(returnTo);
});

router.get("/logout", async (req: Request, res: Response) => {
  const origin = getOrigin(req);

  const sid = getSessionId(req);
  const session = sid ? await getSession(sid) : null;
  await clearSession(res, sid);

  // Local (username/password) sessions have no OIDC session to end.
  if (session?.auth_method === "local") {
    res.redirect(origin);
    return;
  }

  const config = await getOidcConfig();
  const endSessionUrl = oidc.buildEndSessionUrl(config, {
    client_id: process.env.REPL_ID!,
    post_logout_redirect_uri: origin,
  });

  res.redirect(endSessionUrl.href);
});

router.post(
  "/mobile-auth/token-exchange",
  async (req: Request, res: Response) => {
    const parsed = ExchangeMobileAuthorizationCodeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Missing or invalid required parameters" });
      return;
    }

    const { code, code_verifier, redirect_uri, state, nonce } = parsed.data;

    try {
      const config = await getOidcConfig();

      const callbackUrl = new URL(redirect_uri);
      callbackUrl.searchParams.set("code", code);
      callbackUrl.searchParams.set("state", state);
      callbackUrl.searchParams.set("iss", ISSUER_URL);

      const tokens = await oidc.authorizationCodeGrant(config, callbackUrl, {
        pkceCodeVerifier: code_verifier,
        expectedNonce: nonce ?? undefined,
        expectedState: state,
        idTokenExpected: true,
      });

      const claims = tokens.claims();
      if (!claims) {
        res.status(401).json({ error: "No claims in ID token" });
        return;
      }

      const dbUser = await upsertUser(
        claims as unknown as Record<string, unknown>,
      );
      if (!dbUser.isActive || !isKnownAuthorizationRole(dbUser.role)) {
        res.status(403).json({ error: "Access denied", code: "unknown_role" });
        return;
      }

      const now = Math.floor(Date.now() / 1000);
      const sessionData: SessionData = {
        user: {
          id: dbUser.id,
          email: dbUser.email,
          firstName: dbUser.firstName,
          lastName: dbUser.lastName,
          profileImageUrl: dbUser.profileImageUrl,
          role: dbUser.role,
        },
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expiresIn() ? now + tokens.expiresIn()! : claims.exp,
      };

      const sid = await createSession(sessionData);
      res.json(ExchangeMobileAuthorizationCodeResponse.parse({ token: sid }));
    } catch (err) {
      req.log.error({ err }, "Mobile token exchange error");
      res.status(500).json({ error: "Token exchange failed" });
    }
  },
);

router.post("/mobile-auth/logout", async (req: Request, res: Response) => {
  const sid = getSessionId(req);
  if (sid) {
    await deleteSession(sid);
  }
  res.json(LogoutMobileSessionResponse.parse({ success: true }));
});

export default router;
