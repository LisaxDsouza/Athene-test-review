import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

const isPublicRoute = createRouteMatcher(['/sign-in(.*)', '/sign-up(.*)', '/api/health'])

export default clerkMiddleware(async (auth, req) => {
    // 1. Check if the route is public
    if (isPublicRoute(req)) {
        return NextResponse.next()
    }

    // 2. Protect all other routes
    // This internal Clerk method is more robust for redirects
    await auth.protect()

    const { userId, orgId } = await auth()

    // 3. If signed in but no org, send to onboarding or force org selection
    if (userId && !orgId && !req.nextUrl.pathname.startsWith('/onboarding') && !req.nextUrl.pathname.startsWith('/api')) {
        const orgSelection = new URL('/onboarding', req.url)
        return NextResponse.redirect(orgSelection)
    }

    // 4. Inject Zero-Touch headers
    const requestHeaders = new Headers(req.headers)
    if (userId) requestHeaders.set('x-current-user-id', userId)
    if (orgId) requestHeaders.set('x-current-org-id', orgId)
    requestHeaders.set('x-athene-mode', 'zero-touch')

    return NextResponse.next({
        request: {
            headers: requestHeaders,
        },
    })
})

export const config = {
    matcher: [
        '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
        '/(api|trpc)(.*)',
    ],
}
