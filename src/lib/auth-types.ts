import type { Request } from "express";

export interface UserPreferences {
  likedCuisines: string[];
  dietaryRestrictions: {
    isVegetarian: boolean;
    isVegan: boolean;
  };
  favoriteCategories: string[];
}

export interface UserProfile {
  uid: string;
  email: string;
  name: string;
  preferences: UserPreferences | null;
  createdAt: string;
}

export interface UserDocument {
  uid: string;
  email: string;
  name: string;
  passwordHash: string;
  preferences: UserPreferences | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthRequest extends Request {
  uid?: string;
}
