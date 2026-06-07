import { Photo, PhotoStatus } from '../entities/Photo';

export interface PhotoQuery {
  page?:     number;
  limit?:    number;
  status?:   PhotoStatus;
  favorite?: boolean;
  tags?:     string[];
  q?:        string;
  dateFrom?: number;
  dateTo?:   number;
  dirPath?:  string;
  year?:     number;
  month?:    number;
  dirId?:    string;
}

export interface IPhotoRepository {
  upsert(photo: Partial<Photo> & { path: string }): void;
  findById(id: number): Photo | null;
  findByPath(path: string): Photo | null;
  findAll(query?: PhotoQuery): { photos: Photo[]; total: number };
  updateResult(path: string, data: Partial<Photo>): void;
  markStatus(path: string, status: PhotoStatus): void;
  countByStatus(): Record<string, number>;
  findPending(limit?: number): Photo[];
  delete(path: string): void;
}
