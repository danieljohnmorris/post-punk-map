export interface Band {
  name: string
  year: number
  genre: string
  color?: string
}

export interface Genre {
  name: string
  color: string
  bands: Band[]
  position: [number, number]
}

export const genres: Genre[] = [
  {
    name: "Early Post-Punk",
    color: "#c43e3e",
    position: [-7.5, 4],
    bands: [
      { name: "Joy Division", year: 1976 },
      { name: "Siouxsie and\nthe Banshees", year: 1976 },
      { name: "Wire", year: 1976 },
      { name: "Magazine", year: 1977 },
      { name: "The Fall", year: 1976 },
      { name: "Gang of Four", year: 1977 },
      { name: "Public Image Ltd", year: 1978 },
      { name: "Killing Joke", year: 1978 },
    ],
  },
  {
    name: "Gothic / Darkwave",
    color: "#6b2fa0",
    position: [7.5, 4],
    bands: [
      { name: "Bauhaus", year: 1978 },
      { name: "The Cure", year: 1976 },
      { name: "Sisters of Mercy", year: 1980 },
      { name: "Cocteau Twins", year: 1979 },
      { name: "Dead Can Dance", year: 1981 },
      { name: "Clan of Xymox", year: 1981 },
      { name: "Christian Death", year: 1979 },
    ],
  },
  {
    name: "Synth Post-Punk",
    color: "#2a7eb5",
    position: [-7.5, -4],
    bands: [
      { name: "Depeche Mode", year: 1980 },
      { name: "New Order", year: 1980 },
      { name: "OMD", year: 1978 },
      { name: "Ultravox", year: 1974 },
      { name: "Gary Numan", year: 1977 },
      { name: "Cabaret Voltaire", year: 1973 },
      { name: "Fad Gadget", year: 1978 },
    ],
  },
  {
    name: "No Wave",
    color: "#b58b2a",
    position: [0, 4],
    bands: [
      { name: "Sonic Youth", year: 1981 },
      { name: "Swans", year: 1982 },
      { name: "DNA", year: 1978 },
      { name: "Mars", year: 1975 },
      { name: "Teenage Jesus\nand the Jerks", year: 1977 },
      { name: "James Chance", year: 1977 },
    ],
  },
  {
    name: "Post-Punk Revival",
    color: "#3ea06b",
    position: [7.5, -4],
    bands: [
      { name: "Interpol", year: 1997 },
      { name: "Editors", year: 2002 },
      { name: "She Wants\nRevenge", year: 2004 },
      { name: "White Lies", year: 2007 },
      { name: "The Horrors", year: 2005 },
      { name: "Preoccupations", year: 2012 },
    ],
  },
  {
    name: "Modern Post-Punk",
    color: "#b55a2a",
    position: [0, -4],
    bands: [
      { name: "Fontaines D.C.", year: 2017 },
      { name: "Shame", year: 2014 },
      { name: "IDLES", year: 2009 },
      { name: "Dry Cleaning", year: 2018 },
      { name: "Black Country\nNew Road", year: 2018 },
      { name: "Squid", year: 2015 },
      { name: "Protomartyr", year: 2008 },
    ],
  },
]
