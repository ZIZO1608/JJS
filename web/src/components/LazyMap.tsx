import { lazy, Suspense, type ComponentProps } from "react";
import { Spinner } from "./ui";

const MapView = lazy(() => import("./MapView"));

/** The map library loads only when a map is actually shown. */
export function LazyMap(props: ComponentProps<typeof MapView>) {
  return (
    <Suspense fallback={<div className={`grid place-items-center rounded-xl border border-line ${props.className ?? "h-80"}`}><Spinner /></div>}>
      <MapView {...props} />
    </Suspense>
  );
}

export type { MapPoint } from "./MapView";
