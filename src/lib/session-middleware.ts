import { createMiddleware } from "hono/factory";
import { auth } from "./auth";

type Env = {
  Variables: {
    session: typeof auth.$Infer.Session;
  };
};

export const requireAuth = createMiddleware<Env>(async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });

  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  c.set("session", session);
  await next();
});

export const requireSupervisor = createMiddleware<Env>(async (c, next) => {
  const session = c.get("session");

  if (session.user.role !== "SUPERVISOR") {
    return c.json({ error: "Forbidden" }, 403);
  }

  await next();
});
