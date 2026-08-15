import * as React from "react";
import { renderPlaceholders } from "@/lib/landing-blocks/placeholders";
import type { BlockRenderProps } from "@/lib/landing-blocks/types";
import { BlockFrame } from "./block-frame";
import { EditableText, MaybeEmptyField } from "./editable-text";

/**
 * About-Me block — portrait + name + role + bio. Stacks vertically on
 * mobile and switches to a row layout from `sm:` upwards.
 *
 * data shape:
 *   { portraitUrl?; name?; role?; bio? }
 */
export function BlockAboutMe({
  data,
  style,
  leadData,
}: BlockRenderProps): React.ReactElement {
  const portraitUrl =
    typeof data.portraitUrl === "string" ? data.portraitUrl : "";
  const name = renderPlaceholders(
    typeof data.name === "string" ? data.name : undefined,
    leadData,
  );
  const role = renderPlaceholders(
    typeof data.role === "string" ? data.role : undefined,
    leadData,
  );
  const bio = renderPlaceholders(
    typeof data.bio === "string" ? data.bio : undefined,
    leadData,
  );

  return (
    <BlockFrame
      style={style}
      defaults={{ paddingY: "md", maxWidth: "normal", alignment: "left" }}
    >
      <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
        {portraitUrl && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={portraitUrl}
            alt={name || "Portrait"}
            width={96}
            height={96}
            className="size-24 rounded-full object-cover shrink-0"
          />
        )}
        <div className="text-center sm:text-left">
          <MaybeEmptyField present={!!name}>
            <p className="text-lg font-semibold">
              <EditableText
                path="name"
                raw={typeof data.name === "string" ? data.name : ""}
                emptyHint="Name eingeben"
              >
                {name}
              </EditableText>
            </p>
          </MaybeEmptyField>
          <MaybeEmptyField present={!!role}>
            <p className="text-sm opacity-70">
              <EditableText
                path="role"
                raw={typeof data.role === "string" ? data.role : ""}
                emptyHint="Rolle eingeben"
              >
                {role}
              </EditableText>
            </p>
          </MaybeEmptyField>
          <MaybeEmptyField present={!!bio}>
            <p className="mt-2 text-sm sm:text-base leading-relaxed whitespace-pre-line">
              <EditableText
                path="bio"
                raw={typeof data.bio === "string" ? data.bio : ""}
                multiline
                emptyHint="Kurzbio eingeben"
              >
                {bio}
              </EditableText>
            </p>
          </MaybeEmptyField>
        </div>
      </div>
    </BlockFrame>
  );
}
