export type MovementType = 'income' | 'expense';

export interface Category {
  id: string;
  name: string;
  type: MovementType;
  order: number;
  archived: boolean;
  subcategories: { id: string; name: string; archived: boolean; order: number }[];
}

export interface Movement {
  id: string;
  type: MovementType;
  amount: number;
  date: string;
  categoryId: string;
  subcategoryId?: string;
  concept: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Preferences { periodMode: 'month' | 'year'; selectedDate: string }
