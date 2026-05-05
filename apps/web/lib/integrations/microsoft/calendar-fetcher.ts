import { graphFetch } from './graph-client'

export interface EventDraft {
  subject: string
  body?: {
    contentType: 'Text' | 'HTML'
    content: string
  }
  start: {
    dateTime: string
    timeZone: string
  }
  end: {
    dateTime: string
    timeZone: string
  }
  location?: {
    displayName: string
  }
  attendees?: {
    emailAddress: {
      address: string
      name: string
    }
    type: 'required' | 'optional' | 'resource'
  }[]
}

/**
 * Fetches calendar events within a specific time range.
 */
export async function fetchEvents(connectionId: string, orgId: string, startDate: Date, endDate: Date) {
  return graphFetch(connectionId, orgId, `/me/calendarView?startDateTime=${startDate.toISOString()}&endDateTime=${endDate.toISOString()}`)
}

/**
 * Creates a new calendar event.
 * Requires approval upstream.
 */
export async function createEvent(connectionId: string, orgId: string, event: EventDraft) {
  return graphFetch(connectionId, orgId, `/me/events`, {
    method: 'POST',
    body: JSON.stringify(event),
  })
}

/**
 * Finds free meeting slots for a group of attendees.
 * @param duration Duration in minutes.
 */
export async function findFreeSlots(connectionId: string, orgId: string, attendees: string[], duration: number) {
  const attendeeList = attendees.map(email => ({
    emailAddress: { address: email },
    type: 'required'
  }))

  return graphFetch(connectionId, orgId, `/me/findMeetingTimes`, {
    method: 'POST',
    body: JSON.stringify({ 
      attendees: attendeeList, 
      meetingDuration: `PT${duration}M` // Formatted as ISO 8601 duration
    }),
  })
}
