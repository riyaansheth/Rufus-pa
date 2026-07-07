import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";
import { fetchNowPlaying, resolveBookingUrl } from "./assistant";

/**
 * Movies now playing in cinemas (TMDB when configured, live web-search fallback
 * otherwise). Powers the /movies page. Workspace-gated.
 */
export const nowPlaying = action({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, { workspaceId }) => {
    // Verify membership (throws if not a member of this workspace).
    await ctx.runQuery(api.memberships.myRole, { workspaceId });
    return await fetchNowPlaying();
  },
});

/**
 * Resolve the BookMyShow booking link for a specific movie (the real movie page /
 * that day's showtimes via web search). Opening is fine — the human still picks
 * seats and pays.
 */
export const bookingLink = action({
  args: {
    workspaceId: v.id("workspaces"),
    title: v.string(),
    city: v.optional(v.string()),
    date: v.optional(v.string()),
  },
  handler: async (ctx, { workspaceId, title, city, date }): Promise<{ url?: string }> => {
    await ctx.runQuery(api.memberships.myRole, { workspaceId });
    const url = await resolveBookingUrl("movie_ticket", title, city, undefined, date);
    return { url };
  },
});
