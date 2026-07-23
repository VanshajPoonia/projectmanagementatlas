import * as React from 'react'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'

export interface Crumb {
  label: string
  href?: string
}

/** Renders a breadcrumb trail; the last crumb is the current page (non-link). */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  if (items.length === 0) return null
  return (
    <Breadcrumb>
      <BreadcrumbList>
        {items.map((crumb, i) => {
          const isLast = i === items.length - 1
          return (
            <React.Fragment key={`${crumb.label}-${i}`}>
              <BreadcrumbItem>
                {isLast || !crumb.href ? (
                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink href={crumb.href}>{crumb.label}</BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!isLast && <BreadcrumbSeparator />}
            </React.Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
