import { Combobox, Icon, Listbox, Select } from "@shopify/polaris";
import { useCallback, useEffect, useMemo, useState } from "react";
import {BlogIcon, CalendarIcon, CheckboxIcon, CodeIcon, CollectionIcon, FileIcon, HashtagIcon, ImageIcon, LinkIcon, MetaobjectIcon, OrderIcon, OrganizationIcon, PageIcon, PersonIcon, ProductIcon, SearchIcon, TextIcon} from "@shopify/polaris-icons";

export function TypeFieldSelector({ onChange }) {
  const [dataType, setDataType] = useState("single-line-text");

  const handleDataTypeChange = (value) => {
    setDataType(value);
    onChange?.(value);
  };

  const options = [
    {
      label: "Recommended",
      options: [
        { value: "single-line-text", label: "Single line text" },
        { value: "integer", label: "Integer" },
        { value: "image", label: "Image (File)" },
        { value: "metaobject", label: "Metaobject" },
      ],
    },
    {
      label: "Text",
      options: [
        { value: "choice-list", label: "Choice list (Single line text)" },
        { value: "email", label: "Email (Single line text)" },
      ],
    },
    {
      label: "Media",
      options: [{ value: "file", label: "File" }],
    },
  ];

  const selectOptions = options.flatMap((group) => [
    { label: group.label, value: group.label, disabled: true },
    ...(group.options || []),
  ]);

  return (
    <Select
      label="Type"
      options={selectOptions}
      value={dataType}
      onChange={handleDataTypeChange}
    />
  );
}



export function OwnerTypeSelection({ onChange, options = [] }) {
  const [inputValue, setInputValue] = useState("");
  const [ownerType, setOwnerType] = useState(options[0]?.value || "");

  const updateText = useCallback((value) => {
    setInputValue(value);
  }, []);

  const updateSelection = useCallback((selected) => {
    const selectedOption = options.find(option => option.value === selected);

    if (selectedOption) {
      setInputValue(selectedOption.label);
      setOwnerType(selected);
      onChange?.(selected);
    }
  }, [options, onChange]);

  const filteredOptions = useMemo(() => {
    if (!inputValue) return options;

    return options.filter(option =>
      option.label.toLowerCase().includes(inputValue.toLowerCase())
    );
  }, [inputValue, options]);

  const optionsMarkup = filteredOptions.map((option) => (
    <Listbox.Option
      key={option.value}
      value={option.value}
      selected={ownerType === option.value}
      accessibilityLabel={option.label}
    >
      <div style={{padding:"0px 0px 8px 0px"}}>
            <span>{option.label}</span>
      </div>
    </Listbox.Option>
  ));

  return (
    <Combobox
      activator={
        <Combobox.TextField
          label="Owner Type"
          value={inputValue}
          onChange={updateText}
          prefix={<Icon source={SearchIcon} />}
          placeholder="Search owner type"
          autoComplete="off"
        />
      }
    >
      {filteredOptions.length > 0 ? (
        <Listbox onSelect={updateSelection}>
          <div style={{ maxHeight: '280px', overflowY: 'auto', padding:"0px 8px"}}>
            {optionsMarkup}
          </div>
        </Listbox>
      ) : (
        <Listbox>
          <Listbox.Option value="" disabled>
            <s-section as="span" tone="subdued">No results found</s-section>
          </Listbox.Option>
        </Listbox>
      )}
    </Combobox>
  );
}


export function MetaFieldSelection({ onChange, options = [] }) {
  const [metaField, setMetaField] = useState(
    options[0]?.value || ""
  );

  useEffect(() => {
    if (options.length && !metaField) {
      setMetaField(options[0].value);
    }
  }, [options]);

  const handleMetaFieldChange = (value) => {
    setMetaField(value);
    onChange?.(value);
  };

  return (
    <Select
      label="Metafield"
      options={options}
      value={metaField}
      onChange={handleMetaFieldChange}
    />
  );
}



export function FieldTypeSelect({ TYPE_OPTIONS = [], value, onChange }) {
  const [inputValue, setInputValue] = useState("");

  const TYPE_ICON_MAP = {
    single_line_text_field: TextIcon,
    multi_line_text_field: TextIcon,
    rich_text_field: TextIcon,

    number_integer: HashtagIcon,
    number_decimal: HashtagIcon,
    money: HashtagIcon,
    rating: HashtagIcon,
    weight: HashtagIcon,
    volume: HashtagIcon,
    dimension: HashtagIcon,

    date: CalendarIcon,
    date_time: CalendarIcon,

    product_reference: ProductIcon,
    variant_reference: ProductIcon,
    collection_reference: CollectionIcon,
    page_reference: PageIcon,
    order_reference: OrderIcon,
    customer_reference: PersonIcon,
    company_reference: OrganizationIcon,
    blog_reference: BlogIcon,
    metaobject_reference: MetaobjectIcon,

    boolean: CheckboxIcon,
    color: ImageIcon,
    url: LinkIcon,
    json: CodeIcon,
    file_reference: FileIcon,
  };

  const updateText = useCallback((value) => {
    setInputValue(value);
  }, []);

  const updateSelection = useCallback((selected) => {
    const selectedOption = TYPE_OPTIONS
      .flatMap(group => group.options)
      .find(option => option.value === selected);

    if (selectedOption) {
      setInputValue(selectedOption.label);
      onChange?.(selected);
    }
  }, [TYPE_OPTIONS, onChange]);

  const filteredOptions = useMemo(() => {
    if (!inputValue) return TYPE_OPTIONS;

    return TYPE_OPTIONS
      .map(group => ({
        ...group,
        options: group.options.filter(option =>
          option.label.toLowerCase().includes(inputValue.toLowerCase())
        ),
      }))
      .filter(group => group.options.length > 0);
  }, [inputValue, TYPE_OPTIONS]);

  const optionsMarkup = filteredOptions.map((group, index) => (
    <Listbox.Section key={group.title}>
      <div style={{ 
        padding: '8px 16px 2px 16px', 
        fontSize: '13px', 
        fontWeight: '600',
        color: '#6D7175',
        marginTop: index > 0 ? '8px' : '0'
      }}>
        {group.title}
      </div>
      {group.options.map((option) => {
        const IconSource = TYPE_ICON_MAP[option.value];
        
        return (
          <Listbox.Option
            key={option.value}
            value={option.value}
            selected={value === option.value}
            accessibilityLabel={option.label}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding:"8px 12px" }}>
              {IconSource && <Icon source={IconSource} />}
              <span>{option.label}</span>
            </div>
          </Listbox.Option>
        );
      })}
    </Listbox.Section>
  ));

  return (
    <Combobox
      activator={
        <Combobox.TextField
          label="Metafield type"
          value={inputValue}
          onChange={updateText}
          prefix={<Icon source={SearchIcon} />}
          placeholder="Search type"
          autoComplete="off"
        />
      }
    >
      {filteredOptions.length > 0 ? (
        <Listbox onSelect={updateSelection}>
          <div style={{ maxHeight: '280px', overflowY: 'auto' }}>
            {optionsMarkup}
          </div>
        </Listbox>
      ) : (
        <Listbox>
          <Listbox.Option value="" disabled>
            <s-text as="span" tone="subdued">No results found</s-text>
          </Listbox.Option>
        </Listbox>
      )}
    </Combobox>
  );
}
