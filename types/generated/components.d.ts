import type { Schema, Struct } from '@strapi/strapi';

export interface ProjectDetail extends Struct.ComponentSchema {
  collectionName: 'components_project_details';
  info: {
    description: 'Project detail specifications';
    displayName: 'Detail';
    icon: 'layer';
  };
  attributes: {
    buildingAmenities: Schema.Attribute.JSON;
    floors: Schema.Attribute.String;
    location: Schema.Attribute.String;
    locationHighlights: Schema.Attribute.JSON;
    residenceFeatures: Schema.Attribute.JSON;
    size: Schema.Attribute.String;
    type: Schema.Attribute.String;
    units: Schema.Attribute.String;
  };
}

export interface SharedLegalSection extends Struct.ComponentSchema {
  collectionName: 'components_shared_legal_sections';
  info: {
    description: 'A heading + body pair for legal pages';
    displayName: 'Legal Section';
    icon: 'file';
  };
  attributes: {
    body: Schema.Attribute.Text;
    heading: Schema.Attribute.String;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ComponentSchemas {
      'project.detail': ProjectDetail;
      'shared.legal-section': SharedLegalSection;
    }
  }
}
