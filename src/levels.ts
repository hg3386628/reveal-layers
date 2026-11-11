export type Level = {
  id: "window" | "letter" | "city";
  top: string;
  bottom: string;
};

/** Built-in image pairs. Paths are package/public roots (images/...). */
export const levels: Level[] = [
  {
    id: "window",
    top: "images/window-top.jpg",
    bottom: "images/window-bottom.jpg",
  },
  {
    id: "letter",
    top: "images/letter-top.jpg",
    bottom: "images/letter-bottom.jpg",
  },
  {
    id: "city",
    top: "images/city-top.jpg",
    bottom: "images/city-bottom.jpg",
  },
];

export const levelById = (id: string): Level =>
  levels.find((level) => level.id === id) ?? levels[0];
