import type { Request } from "express";

export interface UserPreferences {
  likedCuisines: string[];
  dietaryRestrictions: {
    isVegetarian: boolean;
    isVegan: boolean;
  };
  favoriteCategories: string[];
  /** List of allergen identifiers the user wants to avoid (e.g. "peanuts", "gluten") */
  allergens: string[];
}

export interface UserProfile {
  uid: string;
  email: string;
  name: string;
  preferences: UserPreferences | null;
  createdAt: string;
}

export interface TrialData {
  startDate: string; // ISO timestamp of when trial was activated
  recipesUsed: number;
}

export interface WeeklyExtractionData {
  count: number;
  weekStart: string; // ISO Monday 00:00:00 UTC
}

export interface UserDocument {
  uid: string;
  email: string;
  name: string;
  passwordHash: string;
  preferences: UserPreferences | null;
  trial: TrialData | null;
  weeklyExtractions: WeeklyExtractionData;
  createdAt: string;
  updatedAt: string;
}

export interface AuthRequest extends Request {
  uid?: string;
}
