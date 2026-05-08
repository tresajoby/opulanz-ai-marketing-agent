"use client";

import type { AuthToken, User } from "@/types";

const TOKEN_KEY = "omma_token";
const USER_KEY = "omma_user";

export function saveAuth(token: AuthToken): void {
  localStorage.setItem(TOKEN_KEY, token.access_token);
  localStorage.setItem(USER_KEY, JSON.stringify(token.user));
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getUser(): User | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

export function canApprove(user: User | null): boolean {
  return !!user && (user.role === "super_admin" || user.role === "marketing_manager");
}
