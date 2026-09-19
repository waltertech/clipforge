"use client";

import { GarmentLibrary } from "./garment-library";

export default function GarmentsPage() {
  return (
    <div className="min-h-screen grid-bg">
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <GarmentLibrary />
      </main>
    </div>
  );
}
