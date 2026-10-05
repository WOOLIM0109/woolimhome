import "server-only";
import { portfolioProjects, clientLogoDefinitions } from "./content.ts";
import { designPortfolioProjects } from "./design-portfolio.ts";
import { getClient } from "./clients.ts";
import { clientDisplayName } from "../lib/anonymize.ts";

export function getPublicClientName(clientKey: string) {
  return clientDisplayName(getClient(clientKey));
}

export function getPublicPortfolioProjects() {
  return portfolioProjects.map((project) => ({ ...project, company: getPublicClientName(project.clientKey) }));
}

export function getPublicDesignProjects() {
  return designPortfolioProjects.map((project) => {
    const client = getPublicClientName(project.clientKey);
    return { ...project, client, images: project.images.map((image, index) => ({ src: image.src, alt: `${client} ${project.title} ${index + 1}` })) };
  });
}

export function getPublicLogoClients() {
  return clientLogoDefinitions.map((item) => ({ ...item, name: getPublicClientName(item.clientKey) }));
}
