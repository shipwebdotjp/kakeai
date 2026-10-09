import "@hyperframes/player";
import type * as React from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "hyperframes-player": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          srcdoc?: string;
          controls?: boolean;
        },
        HTMLElement
      >;
    }
  }
}
