# Requirements — Bakery Order Web App

## Sources

- Initial description: "build a web app for a bakery where a user can submit an order" [desc]
- Workflow-selected scope: express [scope]

## Overview

A small public web application for a single bakery. Visitors browse the day's
products, add items to a basket, and submit an order for pickup. Staff see
submitted orders on an internal list. Payment is handled in person at pickup
and is out of scope for this release.

## Functional Requirements

- **FR-1**: The product list must display every item marked available for the
  current day, with name, price and a short description. [desc]
  - Acceptance: given three available and one unavailable product, when the
    visitor opens the product list, then exactly three products are rendered.
- **FR-2**: A visitor must be able to add an available product to a basket and
  change its quantity before submitting. [desc]
  - Acceptance: given a product in the basket at quantity 1, when the visitor
    sets quantity to 3, then the basket total reflects three units.
- **FR-3**: The order form should be easy for customers to use on a phone.
  - Acceptance: the form is usable on mobile.
- **FR-4**: Order submission must reject a basket with no items.
  - Acceptance: given an empty basket, when the visitor submits, then the
    request returns 400 and no order is created.
- **FR-5**: Submitting an order must capture the customer name, phone number
  and requested pickup time, and must persist the order with status `received`.
  - Acceptance: given a valid basket and contact details, when the visitor
    submits, then an order row exists with status `received` and the submitted
    pickup time.
- **FR-6**: Staff must be able to view submitted orders for the current day,
  newest first. [scope]
  - Acceptance: given two orders submitted today, when staff open the order
    list, then both appear with the most recent first.
- **FR-7**: The system must reject a pickup time outside the bakery's opening
  hours. [Q1]
  - Acceptance: given opening hours 07:00–15:00, when a pickup time of 18:00 is
    submitted, then the request returns 400 with a message naming the hours.

## Non-Functional Requirements

- **NFR-1**: The product list must respond within 800 ms at p95 under 50
  concurrent visitors. [assumption]
  - Acceptance: a load test at 50 concurrent users reports p95 under 800 ms.
- **NFR-2**: Customer phone numbers must not appear in application logs.
  - Acceptance: a submitted order produces no log line containing the phone
    number.

## Assumptions & Open Questions

- Allergen information is not captured in this release; the bakery confirms
  allergens by phone at pickup. [assumption]
- Single bakery location, single timezone. [assumption]
- [Q1] Opening hours are fixed at 07:00–15:00 daily. Confirmed with the owner.
