import ROUTES from "./routes";

export const DEFAULT_EMPTY = {
  title: "No data found",
  message: "Looks like the database is taking a nap. Wake it up with some new entries.",
  button: {
    text: "Add data",
    href: ROUTES.HOME,
  },
};

export const DEFAULT_ERROR = {
  title: "Oops! Something went wrong.",
  message: "Even our code can have a bad day. Give it another shot.",
  button: {
    text: "Try Again",
    href: ROUTES.HOME,
  },
};