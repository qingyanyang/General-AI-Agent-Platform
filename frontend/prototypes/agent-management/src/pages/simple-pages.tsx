/** PROTOTYPE simple routes. */
import { Link } from 'react-router-dom'

import { PageFrame } from '../shell'
import { EmptyState } from '../ui'

export function NotFoundPage() {
  return (
    <PageFrame mobileTitle="Not found">
      <div className="mx-auto max-w-lg px-4 py-16 sm:px-8">
        <EmptyState
          title="Page not found"
          action={
            <Link
              to="/chat"
              className="inline-flex h-10 items-center justify-center rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground"
            >
              Back to chat
            </Link>
          }
        >
          That route isn’t part of this prototype. Chat is the default destination.
        </EmptyState>
      </div>
    </PageFrame>
  )
}
