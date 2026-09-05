import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** shadcn 규약의 클래스 병합 유틸. 생성물이 이 경로를 기대한다(`components.json`). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
